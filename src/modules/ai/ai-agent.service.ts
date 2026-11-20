import { logger } from "../../config/logger.js";
import type { AiMessage, AiToolDef } from "./providers/aigrid.provider.js";
import { aiComplete } from "./ai.service.js";
import { buildCustomerSupportPrompt } from "./prompts/customer-support.prompt.js";
import { conversationMemory, ConversationMemory } from "./memory/conversation-memory.js";
import { searchProducts, PRODUCT_SEARCH_TOOL_DEF, type ProductSearchInput } from "./tools/product-search.tool.js";
import { lookupCustomer, CUSTOMER_LOOKUP_TOOL_DEF, type CustomerLookupInput } from "./tools/customer-lookup.tool.js";
import { createOrderFromChat, ORDER_CREATION_TOOL_DEF, type OrderCreationInput } from "./tools/order-creation.tool.js";
import { getOrderStatus, ORDER_STATUS_TOOL_DEF, type OrderStatusInput } from "./tools/order-status.tool.js";

const ALL_TOOLS: AiToolDef[] = [
  PRODUCT_SEARCH_TOOL_DEF,
  CUSTOMER_LOOKUP_TOOL_DEF,
  ORDER_CREATION_TOOL_DEF,
  ORDER_STATUS_TOOL_DEF,
];

const MAX_TOOL_ROUNDS = 5;

export interface AgentResponse {
  reply: string;
  toolsUsed: string[];
}

/**
 * Process a customer message through the AI agent.
 * Manages conversation memory, native tool calling loop, and response generation.
 */
export async function handleCustomerMessage(
  storeId: string,
  storeName: string,
  telegramUserId: string,
  message: string,
): Promise<AgentResponse> {
  const sessionKey = ConversationMemory.sessionKey(storeId, telegramUserId);
  const toolsUsed: string[] = [];

  conversationMemory.addMessage(sessionKey, { role: "user", content: message });

  const systemPrompt = buildCustomerSupportPrompt(storeName);
  const session = conversationMemory.get(sessionKey)!;

  // Build the message list for this request. The system prompt is always first,
  // followed by the conversation history. Tool call/result messages are added
  // within the loop and NOT persisted to conversation memory (they're ephemeral
  // context for the current turn).
  const messages: AiMessage[] = [
    { role: "system", content: systemPrompt },
    ...session.messages,
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const result = await aiComplete({
      messages,
      tools: ALL_TOOLS,
      temperature: 0.5,
      maxTokens: 2048,
    });

    // If the model returned text (not tool calls), we're done.
    if (result.toolCalls.length === 0) {
      const reply = result.content ?? "عذراً، لم أتمكن من الرد. / Sorry, I couldn't respond.";
      conversationMemory.addMessage(sessionKey, { role: "assistant", content: reply });
      return { reply, toolsUsed };
    }

    // The model wants to call tools. Add the assistant's tool-call message,
    // execute each tool, and add the results.
    messages.push({
      role: "assistant",
      content: null,
      tool_calls: result.toolCalls,
    });

    for (const toolCall of result.toolCalls) {
      const toolName = toolCall.function.name;
      toolsUsed.push(toolName);

      logger.debug({ toolName, sessionKey, round }, "AI agent invoking tool");

      const toolResult = await executeTool(toolName, toolCall.function.arguments, storeId, telegramUserId);

      messages.push({
        role: "tool",
        content: JSON.stringify(toolResult),
        tool_call_id: toolCall.id,
      });
    }
    // Loop continues — the model will see the tool results and either respond or call more tools.
  }

  // Exceeded max rounds — return a fallback.
  const fallback = "عذراً، حدث خطأ أثناء معالجة طلبك. يرجى المحاولة مرة أخرى. / Sorry, an error occurred. Please try again.";
  conversationMemory.addMessage(sessionKey, { role: "assistant", content: fallback });
  return { reply: fallback, toolsUsed };
}

async function executeTool(
  name: string,
  argsJson: string,
  storeId: string,
  telegramUserId: string,
): Promise<unknown> {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argsJson) as Record<string, unknown>;
  } catch {
    return { error: "Invalid tool arguments" };
  }

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
