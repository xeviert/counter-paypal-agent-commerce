import { Suspense } from "react";
import { PageLoading } from "@/components/maker/page-loading";
import { requireSeller } from "@/lib/auth/seller";
import { getDb } from "@/lib/db";
import { COPILOT_TURN_LIMIT, latestConversation } from "@/lib/shop/copilot";
import { CopilotChat } from "./copilot-chat";

export default function CopilotPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Copilot />
    </Suspense>
  );
}

async function Copilot() {
  const seller = await requireSeller();
  const chat = await latestConversation(getDb(), seller.id);
  return (
    <CopilotChat
      conversationId={chat.conversationId}
      messages={chat.messages}
      actions={chat.actions}
      full={chat.turns >= COPILOT_TURN_LIMIT}
    />
  );
}
