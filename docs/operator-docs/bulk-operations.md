---
id: bulk-operations
title: Bulk Operations
hide_title: false
---

Cumulus implements bulk operations through the use of `AsyncOperations`, which are long-running processes executed on an AWS ECS cluster.

## Submitting a bulk request

Bulk operations are generally submitted via the endpoint for the relevant data type, e.g. granules. For a list of supported API requests, refer to the [Cumulus API documentation](https://nasa.github.io/cumulus-api/#bulk-operations). Bulk operations are denoted with the keyword 'bulk'.

## Status Tracking

All bulk operations return an `AsyncOperationId` which can be submitted to the `/asyncOperations` endpoint.

The `/asyncOperations` endpoint allows listing of AsyncOperation records as well as record retrieval for individual records, which will contain the status.
The [Cumulus API documentation](https://nasa.github.io/cumulus-api/#list-async-operations) shows sample requests for these actions.

The Cumulus Dashboard also includes an Operations monitoring page, where operations and their status are visible:

![Screenshot of Cumulus Dashboard Operations Page](assets/cd_operations_page.png)