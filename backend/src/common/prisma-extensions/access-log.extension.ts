import type { ClsService } from 'nestjs-cls'
import { Prisma } from '../../generated/prisma/client.js'

// TODO(Duwaragie, Thu): flesh out the query wrappers to write AccessLog rows
// for each read/write on PHI models. Today: just export the placeholder so the
// module wiring exists and can be imported. Thursday's PR adds the
// query.$allModels handlers that read actorId/actorType/ip/userAgent off the
// injected ClsService and INSERT one AccessLog row per PHI operation.
//
// The generated Prisma client re-exports the Prisma namespace (including
// defineExtension) — this project generates into src/generated/prisma rather
// than @prisma/client, so import from there.
export function accessLogExtension(_cls: ClsService) {
  return Prisma.defineExtension({
    name: 'access-log',
    // Thursday: add query.$allModels handlers here for the PHI model list.
  })
}
