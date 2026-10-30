import { eq } from "drizzle-orm";
import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { photos } from "@/lib/db/schema";
import { uuid } from "@/lib/schemas/common";

// Photo ids are random UUIDs handed out only with live listings. Bytes never change for an id
// (a new photo gets a new row), so responses cache forever.

export async function GET(_request: Request, { params }: RouteContext<"/api/photos/[id]">) {
  await connection();
  const { id } = await params;
  if (!uuid.safeParse(id).success) return new Response("Not found", { status: 404 });
  const [photo] = await getDb()
    .select({ bytes: photos.bytes, mime: photos.mime })
    .from(photos)
    .where(eq(photos.id, id));
  if (!photo) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(photo.bytes), {
    headers: {
      "Content-Type": photo.mime,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
