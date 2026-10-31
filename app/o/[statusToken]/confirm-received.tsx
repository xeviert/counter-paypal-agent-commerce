"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { confirmReceived } from "./actions";

export function ConfirmReceived({ token }: { token: string }) {
  const [pending, start] = useTransition();
  return (
    <Dialog>
      <DialogTrigger render={<Button size="lg" variant="outline" />}>I received it</DialogTrigger>
      <DialogContent>
        <DialogTitle>Did your order arrive?</DialogTitle>
        <DialogDescription>
          Confirming pays the maker now. If something is wrong with it, open a dispute on PayPal instead.
        </DialogDescription>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Not yet</DialogClose>
          <Button disabled={pending} onClick={() => start(() => confirmReceived(token))}>
            {pending ? "Confirming…" : "Yes, it arrived"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
