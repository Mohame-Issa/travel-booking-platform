import type { ClientSession, Model } from 'mongoose';
import type { Room } from './schemas/room.schema.js';

/**
 * Serializes inventory changes per room. Every transaction that reads and then
 * writes a room's RoomAvailability rows first writes the Room document itself.
 * Two concurrent transactions on the same room then hit a write conflict; MongoDB
 * aborts one, connection.transaction() retries it, and the retry sees the winner's
 * rows. A preliminary availability read alone would not prevent double booking.
 * Returns how many of the rooms exist.
 */
export async function lockRooms(
  rooms: Model<Room>,
  roomIds: unknown[],
  session: ClientSession,
): Promise<number> {
  const res = await rooms
    .updateMany(
      { _id: { $in: roomIds } },
      { $currentDate: { updatedAt: true } },
      { session, timestamps: false },
    )
    .exec();
  return res.matchedCount;
}
