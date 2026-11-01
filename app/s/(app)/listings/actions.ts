"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSeller } from "@/lib/auth/seller";
import { getDb } from "@/lib/db";
import { setAutoNegotiate, setProductStatus, setProductStock } from "@/lib/shop/seller-products";

export async function changeStatus(form: FormData): Promise<void> {
  const seller = await requireSeller();
  const action = z.enum(["pause", "resume"]).safeParse(form.get("action"));
  if (!action.success) return;
  await setProductStatus(getDb(), seller, String(form.get("productId")), action.data);
  revalidatePath("/s/listings");
}

export async function changeNegotiation(form: FormData): Promise<void> {
  const seller = await requireSeller();
  const to = z.enum(["on", "off"]).safeParse(form.get("to"));
  if (!to.success) return;
  await setAutoNegotiate(getDb(), seller.id, String(form.get("productId")), to.data === "on");
  revalidatePath("/s/listings");
}

export async function changeStock(form: FormData): Promise<void> {
  const seller = await requireSeller();
  await setProductStock(getDb(), seller.id, String(form.get("productId")), Number(form.get("stock")));
  revalidatePath("/s/listings");
}
