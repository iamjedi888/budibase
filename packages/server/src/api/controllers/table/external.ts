import { breakExternalTableId } from "../../../integrations/utils"
import { handleRequest } from "../row/external"
import { events } from "@budibase/backend-core"
import { isRows, isSchema, parse } from "../../../utilities/schema"
import {
  BulkImportRequest,
  BulkImportResponse,
  Operation,
  RenameColumn,
  SaveTableRequest,
  SaveTableResponse,
  Table,
  TableRequest,
  UserCtx,
} from "@budibase/types"
import sdk from "../../../sdk"
import { builderSocket } from "../../../websockets"
import { inputProcessing } from "../../../utilities/rowProcessor"

function getDatasourceId(table: Table) {
  if (!table) {
    throw "No table supplied"
  }
  if (table.sourceId) {
    return table.sourceId
  }
  return breakExternalTableId(table._id).datasourceId
}

export async function save(
  ctx: UserCtx<SaveTableRequest, SaveTableResponse>,
  renaming?: RenameColumn
) {
  const inputs = ctx.request.body
  // can't do this right now
  delete inputs.rows
  const tableId = ctx.request.body._id
  const datasourceId = getDatasourceId(ctx.request.body)
  // table doesn't exist already, note that it is created
  if (!inputs._id) {
    inputs.created = true
  }
  try {
    const { datasource, table } = await sdk.tables.external.save(
      datasourceId!,
      inputs,
      { tableId, renaming }
    )
    builderSocket?.emitDatasourceUpdate(ctx, datasource)
    return table
  } catch (err: any) {
    if (err instanceof Error) {
      ctx.throw(400, err.message)
    } else {
      ctx.throw(err.status || 500, err?.message || err)
    }
  }
}

export async function destroy(ctx: UserCtx) {
  const tableToDelete: TableRequest = await sdk.tables.getTable(
    ctx.params.tableId
  )
  const datasourceId = getDatasourceId(tableToDelete)
  try {
    const { datasource, table } = await sdk.tables.external.destroy(
      datasourceId!,
      tableToDelete
    )
    builderSocket?.emitDatasourceUpdate(ctx, datasource)
    return table
  } catch (err: any) {
    if (err instanceof Error) {
      ctx.throw(400, err.message)
    } else {
      ctx.throw(err.status || 500, err.message || err)
    }
  }
}

export async function bulkImport(
  ctx: UserCtx<BulkImportRequest, BulkImportResponse>
) {
  let table = await sdk.tables.getTable(ctx.params.tableId)
  const { rows } = ctx.request.body
  const schema = table.schema

  if (!rows || !isRows(rows) || !isSchema(schema)) {
    ctx.throw(400, "Provided data import information is invalid.")
  }

  const parsedRows = []
  for (const row of parse(rows, schema)) {
    const processed = await inputProcessing(ctx.user?._id, table, row, {
      noAutoRelationships: true,
    })
    parsedRows.push(processed.row)
    table = processed.table
  }

  await handleRequest(Operation.BULK_CREATE, table._id!, {
    rows: parsedRows,
  })
  await events.rows.imported(table, parsedRows.length)
  return table
}
