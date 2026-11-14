<!-- Generated: 2026-11-13 | Files scanned: schemas under backend/src | Token estimate: ~500 -->
# Data (MongoDB, shared Atlas DB; transactions need a replica set)

| Collection | Schema file | Key fields / indexes |
|---|---|---|
| users, moderatorassignments, sessions | users/schemas, auth/schemas | email unique; one provider per moderator |
| airlines, airlinepolicies | airlines/schemas | code unique; logoUrl (from uploads) |
| airports, countries/cities/attractions | airports/schemas, seed/schemas | official string ids |
| flights, cabininventories, flightevents | flights/schemas | bookedSeats/heldSeats, inventoryRevision, outbox events |
| hotels, rooms, roomavailabilities, hotelpolicies | hotels/schemas | availability [startDate,endDate) UTC midnight, kind Available/Blocked/Pending Payment/Confirmed |
| payments, refunds | payments/schemas, refunds/schemas | Stripe ids, amountMinor |
| auditlogs | audit/schemas/audit-log.schema.ts | actorId→User, action, targetType, targetId, details; idx createdAt |
| notifications | notifications/schemas/notification.schema.ts | userId→User, type, title, message, data, readAt; idx {userId,createdAt}, {userId,readAt} |
| uploads | uploads/schemas/upload.schema.ts | uploaderId→User, storedName unique, mimeType, size, ownerType/ownerId/slot; unique partial {ownerType,ownerId,slot} where ownerId set |

Relationships: Upload.ownerId → airline/hotel/post/activity (polymorphic by ownerType).
No migrations framework; indexes are created by Mongoose autoIndex.
