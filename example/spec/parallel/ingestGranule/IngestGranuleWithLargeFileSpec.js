'use strict';

const get = require('lodash/get');
const pAll = require('p-all');
const pick = require('lodash/pick');
const { randomId } = require('@cumulus/common/test-utils');

const { createCollection } = require('@cumulus/integration-tests/Collections');
const {
  findExecutionArn, getExecutionWithStatus
} = require('@cumulus/integration-tests/Executions');
const { getGranuleWithStatus } = require('@cumulus/integration-tests/Granules');
const { createProvider } = require('@cumulus/integration-tests/Providers');
const { createOneTimeRule } = require('@cumulus/integration-tests/Rules');

const { deleteCollection } = require('@cumulus/api-client/collections');
const { deleteGranule } = require('@cumulus/api-client/granules');
const { deleteProvider } = require('@cumulus/api-client/providers');
const { deleteRule } = require('@cumulus/api-client/rules');

const { loadConfig } = require('../../helpers/testUtils');
const { fetchFakeS3ProviderBucket } = require('../../helpers/Providers');

describe('The IngestGranule workflow ingesting a 300M file', () => {
  let beforeAllFailed = false;
  let collection;
  let ingestGranuleRule;
  let granuleId;
  let ingestGranuleExecution;
  let prefix;
  let provider;
  let sourceBucket;

  beforeAll(async () => {
    try {
      const config = await loadConfig();
      prefix = config.stackName;
      sourceBucket = await fetchFakeS3ProviderBucket();

      // Create the collection
      collection = await createCollection(
        prefix,
        {
          duplicateHandling: 'version',
          process: 'modis'
        }
      );

      // Create the S3 provider
      provider = await createProvider(prefix, { host: sourceBucket });

      granuleId = randomId('granule-id-');

      // Ingest the granule the first time
      ingestGranuleRule = await createOneTimeRule(
        prefix,
        {
          workflow: 'IngestGranule',
          collection: pick(collection, ['name', 'version']),
          provider: provider.id,
          payload: {
            testExecutionId: randomId('test-execution-'),
            granules: [
              {
                granuleId,
                dataType: collection.name,
                version: collection.version,
                files: [
                  {
                    name: '300M.dat',
                    path: ''
                  }
                ]
              }
            ]
          }
        }
      );

      // Find the execution ARN
      const ingestGranuleExecutionArn = await findExecutionArn(
        prefix,
        (execution) => {
          const executionId = get(execution, 'originalPayload.testExecutionId');
          return executionId === ingestGranuleRule.payload.testExecutionId;
        },
        { timeout: 15 }
      );

      // Wait for the execution to be completed
      ingestGranuleExecution = await getExecutionWithStatus({
        prefix,
        arn: ingestGranuleExecutionArn,
        status: 'completed'
      });

      // Wait for the granule to be fully ingested
      await getGranuleWithStatus({ prefix, granuleId, status: 'completed' });
    } catch (error) {
      beforeAllFailed = true;
      throw error;
    }
  });

  it('succeeds', () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    else {
      // If the `beforeAll` succeeded then this will always be true, but it
      // seemed sad to just say `expect.nothing()` after all that work.
      expect(ingestGranuleExecution.status).toBe('completed');
    }
  });

  afterAll(async () => {
    // Must delete rules before deleting associated collection and provider
    await pAll(
      [
        () => deleteRule({ prefix, ruleName: get(ingestGranuleRule, 'name') })
      ],
      { stopOnError: false }
    ).catch(console.error);

    await pAll(
      [
        () => deleteGranule({ prefix, granuleId }),
        () => deleteProvider({ prefix, providerId: get(provider, 'id') }),
        () => deleteCollection({
          prefix,
          collectionName: get(collection, 'name'),
          collectionVersion: get(collection, 'version')
        })
      ],
      { stopOnError: false }
    ).catch(console.error);
  });
});
