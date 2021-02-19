const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const {
  CollectionPgModel,
  ExecutionPgModel,
  GranulePgModel,
  generateLocalTestDb,
  destroyLocalTestDb,
  fakeCollectionRecordFactory,
  fakeExecutionRecordFactory,
  fakeGranuleRecordFactory,
  upsertGranuleWithExecutionHistory,
} = require('../../dist');

const {
  GranulesExecutionsPgModel,
} = require('../../dist/models/granules-executions');

const { migrationDir } = require('../../../../lambdas/db-migration/dist/lambda');

const testDbName = `granule_lib_${cryptoRandomString({ length: 10 })}`;

test.before(async (t) => {
  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  t.context.granulePgModel = new GranulePgModel();
  t.context.granulesExecutionsPgModel = new GranulesExecutionsPgModel();

  const collectionPgModel = new CollectionPgModel();
  t.context.collection = fakeCollectionRecordFactory();
  const collectionResponse = await collectionPgModel.create(
    t.context.knex,
    t.context.collection
  );
  t.context.collectionCumulusId = collectionResponse[0];

  t.context.executionPgModel = new ExecutionPgModel();
});

test.beforeEach(async (t) => {
  const [executionCumulusId] = await t.context.executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory()
  );
  t.context.executionCumulusId = executionCumulusId;
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
});

test('upsertGranuleWithExecutionHistory() adds execution history', async (t) => {
  const {
    knex,
    granulePgModel,
    collectionCumulusId,
    executionCumulusId,
    granulesExecutionsPgModel,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
    status: 'running',
  });

  const [granuleCumulusId] = await knex.transaction(
    (trx) => upsertGranuleWithExecutionHistory(
      trx,
      granule,
      executionCumulusId
    )
  );

  const granuleRecord = await granulePgModel.get(
    knex,
    granule
  );

  t.like(
    granuleRecord,
    {
      ...granule,
      cumulus_id: granuleCumulusId,
    }
  );
  t.deepEqual(
    await granulesExecutionsPgModel.search(
      knex,
      { granule_cumulus_id: granuleCumulusId }
    ),
    [{
      granule_cumulus_id: Number(granuleCumulusId),
      execution_cumulus_id: executionCumulusId,
    }]
  );
});

test('upsertGranuleWithExecutionHistory() handles multiple executions for a granule', async (t) => {
  const {
    knex,
    granulePgModel,
    executionPgModel,
    granulesExecutionsPgModel,
    collectionCumulusId,
    executionCumulusId,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
    status: 'completed',
  });

  const [granuleCumulusId] = await knex.transaction(
    (trx) => upsertGranuleWithExecutionHistory(
      trx,
      granule,
      executionCumulusId
    )
  );

  const [secondExecutionCumulusId] = await executionPgModel.create(
    knex,
    fakeExecutionRecordFactory()
  );

  await knex.transaction(
    (trx) => upsertGranuleWithExecutionHistory(
      trx,
      granule,
      secondExecutionCumulusId
    )
  );

  const granuleRecord = await granulePgModel.get(
    knex,
    granule
  );

  t.like(
    granuleRecord,
    {
      ...granule,
      cumulus_id: granuleCumulusId,
    }
  );
  t.deepEqual(
    await granulesExecutionsPgModel.search(
      knex,
      { granule_cumulus_id: granuleCumulusId }
    ),
    [executionCumulusId, secondExecutionCumulusId].map((executionId) => ({
      granule_cumulus_id: Number(granuleCumulusId),
      execution_cumulus_id: executionId,
    }))
  );
});

test('upsertGranuleWithExecutionHistory() when using a transaction does not write anything if execution history upsert fails', async (t) => {
  const {
    knex,
    granulePgModel,
    collectionCumulusId,
    executionCumulusId,
    granulesExecutionsPgModel,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
    status: 'running',
  });

  const fakeGranulesExecutionsPgModel = {
    upsert: async () => {
      throw new Error('error');
    },
  };

  await t.throwsAsync(
    knex.transaction(
      (trx) =>
        upsertGranuleWithExecutionHistory(
          trx,
          granule,
          executionCumulusId,
          undefined,
          fakeGranulesExecutionsPgModel
        )
    )
  );

  t.false(
    await granulePgModel.exists(
      knex,
      {
        granule_id: granule.granule_id,
        collection_cumulus_id: collectionCumulusId,
      }
    )
  );
  t.false(
    await granulesExecutionsPgModel.exists(
      knex,
      {
        execution_cumulus_id: executionCumulusId,
      }
    )
  );
});

test('upsertGranuleWithExecutionHistory() will allow a running status to replace a non-running status for different execution', async (t) => {
  const {
    knex,
    granulePgModel,
    executionPgModel,
    granulesExecutionsPgModel,
    collectionCumulusId,
    executionCumulusId,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
    status: 'completed',
  });

  const [granuleCumulusId] = await upsertGranuleWithExecutionHistory(
    knex,
    granule,
    executionCumulusId
  );

  const [secondExecutionCumulusId] = await executionPgModel.create(
    knex,
    fakeExecutionRecordFactory()
  );

  const updatedGranule = {
    ...granule,
    status: 'running',
  };

  await upsertGranuleWithExecutionHistory(
    knex,
    updatedGranule,
    secondExecutionCumulusId
  );

  const granuleRecord = await granulePgModel.get(
    knex,
    updatedGranule
  );

  t.like(
    granuleRecord,
    {
      ...updatedGranule,
      cumulus_id: granuleCumulusId,
    }
  );
  t.deepEqual(
    await granulesExecutionsPgModel.search(
      knex,
      { granule_cumulus_id: granuleCumulusId }
    ),
    [executionCumulusId, secondExecutionCumulusId].map((executionId) => ({
      granule_cumulus_id: Number(granuleCumulusId),
      execution_cumulus_id: executionId,
    }))
  );
});

test('upsertGranuleWithExecutionHistory() succeeds if upsert() affects no rows', async (t) => {
  const {
    knex,
    granulePgModel,
    granulesExecutionsPgModel,
    collectionCumulusId,
    executionCumulusId,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
    status: 'completed',
  });

  const [granuleCumulusId] = await upsertGranuleWithExecutionHistory(
    knex,
    granule,
    executionCumulusId
  );

  const updatedGranule = {
    ...granule,
    status: 'running',
  };

  await upsertGranuleWithExecutionHistory(
    knex,
    updatedGranule,
    executionCumulusId
  );

  const granuleRecord = await granulePgModel.get(
    knex,
    granule
  );

  t.like(
    granuleRecord,
    {
      ...granule,
      cumulus_id: granuleCumulusId,
    }
  );
  t.deepEqual(
    await granulesExecutionsPgModel.search(
      knex,
      { granule_cumulus_id: granuleCumulusId }
    ),
    [executionCumulusId].map((executionId) => ({
      granule_cumulus_id: Number(granuleCumulusId),
      execution_cumulus_id: executionId,
    }))
  );
});
