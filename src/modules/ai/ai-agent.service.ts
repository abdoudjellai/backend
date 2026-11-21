import { logger } from "../../config/logger.js";
import type { AiToolDef } from "./providers/aigrid.provider.js";
import { buildCustomerSupportPrompt } from "./prompts/customer-support.prompt.js";
import { conversationMemory, ConversationMemory } from "./memory/conversation-memory.js";
import { runAgentLoop, parseToolArgs } from "./agent-loop.js";
import { searchProducts, PRODUCT_SEARCH_TOOL_DEF, type ProductSearchInput, type ProductSearchResult } from "./tools/product-search.tool.js";
import { lookupCustomer, CUSTOMER_LOOKUP_TOOL_DEF, type CustomerLookupInput } from "./tools/customer-lookup.tool.js";
import { createOrderFromChat, ORDER_CREATION_TOOL_DEF, type OrderCreationInput, type OrderCreationResult } from "./tools/order-creation.tool.js";
import { getOrderStatus, ORDER_STATUS_TOOL_DEF, type OrderStatusInput } from "./tools/order-status.tool.js";

const ALL_TOOLS: AiToolDef[] = [
  PRODUCT_SEARCH_TOOL_DEF,
  CUSTOMER_LOOKUP_TOOL_DEF,
  ORDER_CREATION_TOOL_DEF,
  ORDER_STATUS_TOOL_DEF,
];

export interface AgentResponse {
  reply: string;
  toolsUsed: string[];
}

const FALLBACK_REPLY = "عذراً، حدث خطأ أثناء معالجة طلبك. يرجى المحاولة مرة أخرى. / Sorry, an error occurred. Please try again.";

/**
 * Process a customer message through the AI customer-support agent.
 * Manages conversation memory and the shared tool-calling loop.
 */
export async function handleCustomerMessage(
  storeId: string,
  storeName: string,
  telegramUserId: string,
  message: string,
): Promise<AgentResponse> {
  const sessionKey = ConversationMemory.sessionKey(storeId, telegramUserId);

  conversationMemory.addMessage(sessionKey, { role: "user", content: message });
  const session = conversationMemory.get(sessionKey)!;

  const result = await runAgentLoop({
    systemPrompt: buildCustomerSupportPrompt(storeName),
    messages: session.messages,
    tools: ALL_TOOLS,
    temperature: 0.5,
    maxTokens: 2048,
    executeTool: (name, argsJson) => executeTool(name, argsJson, storeId, telegramUserId),
    onToolResult: (name, argsJson, toolResult) => {
      updateDraftFromToolResult(sessionKey, name, argsJson, toolResult);
    },
  });

  const reply = result.reply || FALLBACK_REPLY;
  conversationMemory.addMessage(sessionKey, { role: "assistant", content: reply });
  return { reply, toolsUsed: result.toolsUsed };
}

function updateDraftFromToolResult(
  sessionKey: string,
  toolName: string,
  argsJson: string,
  result: unknown,
): void {
  try {
    if (toolName === "search_products") {
      const products = result as ProductSearchResult[];
      if (products.length === 1) {
        const p = products[0]!;
        conversationMemory.updateDraft(sessionKey, {
          items: [{ productId: p.id, productName: p.name, quantity: 1, size: null, color: null }],
        });
      }
    }

    if (toolName === "lookup_customer") {
      const lookup = result as { found: boolean; customer: { name: string | null; phone: string | null; wilaya: string | null; address: string | null } | null };
      if (lookup.found && lookup.customer) {
        conversationMemory.updateDraft(sessionKey, {
          customerName: lookup.customer.name,
          customerPhone: lookup.customer.phone,
          wilaya: lookup.customer.wilaya,
          address: lookup.customer.address,
        });
      }
    }

    if (toolName === "create_order") {
      const args = JSON.parse(argsJson) as Record<string, unknown>;
      const creation = result as OrderCreationResult;
      conversationMemory.updateDraft(sessionKey, {
        customerName: typeof args.customerName === "string" ? args.customerName : null,
        customerPhone: typeof args.customerPhone === "string" ? args.customerPhone : null,
        wilaya: typeof args.wilaya === "string" ? args.wilaya : null,
        address: typeof args.address === "string" ? args.address : null,
        confirmed: creation.success,
      });
      if (creation.success) {
        conversationMemory.resetDraft(sessionKey);
      }
    }
  } catch {
    // Draft tracking is best-effort — never fail the agent loop.
  }
}

async function executeTool(
  name: string,
  argsJson: string,
  storeId: string,
  telegramUserId: string,
): Promise<unknown> {
  const args = parseToolArgs(argsJson);
  if ("error" in args) return args;

  try {
    switch (name) {
      case "search_products": {
        const input: ProductSearchInput = {
          storeId,
          query: String(args.query ?? ""),
          size: args.size !== undefined ? (args.size as string | number) : undefined,
          color: args.color !== undefined ? String(args.color) : undefined,
        };
        return searchProducts(input);
      }

      case "lookup_customer": {
        const input: CustomerLookupInput = { storeId, telegramUserId };
        return lookupCustomer(input);
      }

      case "create_order": {
        const input: OrderCreationInput = {
          storeId,
          telegramUserId,
          customerName: String(args.customerName ?? ""),
          customerPhone: String(args.customerPhone ?? ""),
          wilaya: String(args.wilaya ?? ""),
          address: String(args.address ?? ""),
          items: Array.isArray(args.items)
            ? (args.items as { productId: string; quantity: number; size?: string | number | null; color?: string | null }[])
            : [],
        };
        return createOrderFromChat(input);
      }

      case "get_order_status": {
        const input: OrderStatusInput = {
          storeId,
          telegramUserId,
          orderId: args.orderId !== undefined ? String(args.orderId) : undefined,
        };
        return getOrderStatus(input);
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (error) {
    logger.error({ err: error, tool: name }, "Tool execution failed");
    return { error: "Tool execution failed" };
  }
}
