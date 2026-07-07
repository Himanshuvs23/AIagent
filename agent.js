import { planner } from "./agent/planner.js";
import { executePlan } from "./agent/executer.js";
import { reflect } from "./agent/reflect.js";
import { subAgent } from "./agent/tools.js";

const REFLECTION_ENABLED = process.env.ENABLE_REFLECTION === "true";

function stripAnsi(text = "") {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

function wantsStructuredOutput(query = "") {
  return /\b(json|code|raw|object|schema|api response)\b/i.test(query);
}

function formatAgentResult(result, query) {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    if (result.success === false && result.error) {
      const clean = stripAnsi(String(result.error)).split("\n")[0].trim();
      return `Error: ${clean}`;
    }
    if (wantsStructuredOutput(query)) {
      return JSON.stringify(result, null, 2);
    }
    if (result.success === true && result.action === "sentEmail") {
      return `Email sent successfully to ${result.to}.`;
    }
    if (result.success === true && result.action === "openApplication") {
      return `Done. Opened ${result.appName}.`;
    }
    if (result.success === true && typeof result.path === "string") {
      return `Done. File created at ${result.path}`;
    }
    if (result.success === true && typeof result.output === "string") {
      if(result.output == ""){
         return "Done. Task is completed but there is No output returned.";
      }
      return result.output;
    }
    if (result.success === true) {
      return "Done.";
    }
  
    if (typeof result.output === "string") return result.output;
    return String(result.message || "Completed.");
  }
  return String(result ?? "done");
}

function normalizeUserQuery(input) {
  if (typeof input === "string") return input;
  if (input && typeof input === "object") {
    if (typeof input.content === "string") return input.content;
    if (typeof input.message === "string") return input.message;
    if (Array.isArray(input.messages) && typeof input.messages[0]?.content === "string") {
      return input.messages[0].content;
    }
  }
  return String(input ?? "");
}

function buildPlannerMessages(messages = [], normalizedQuery = "") {
  const safeMessages = Array.isArray(messages) ? messages : [];
  const lastMessage = safeMessages[safeMessages.length - 1];

  if (
    lastMessage?.role === "user" &&
    typeof lastMessage?.content === "string" &&
    lastMessage.content.trim() === normalizedQuery.trim()
  ) {
    return safeMessages;
  }

  return [...safeMessages, { role: "user", content: normalizedQuery }];
}

function shouldAttemptResearchSynthesis(result, evaluation) {
  if (typeof result !== "string" || !result.trim()) {
    return false;
  }

  const lowerResult = result.toLowerCase();
  const lowerReason = String(evaluation?.reason || "").toLowerCase();

  return (
    lowerResult.includes("research summary for") ||
    lowerResult.includes("detailed sources:") ||
    lowerReason.includes("does not provide a complete data analysis") ||
    lowerReason.includes("would need to visit each link")
  );
}

export async function agent({ messages = [], input }) {
  try {
    console.log("USER INPUT:", input);
    const userQuery = input;

    const normalizedQuery = normalizeUserQuery(userQuery);
    console.log("USER QUERY:", normalizedQuery);

    const contextMessages = buildPlannerMessages(messages, normalizedQuery);

    const plan = await planner({
      messages: contextMessages,
      userQuery: normalizedQuery
    });

    console.log("Generated Plan:");
    console.log(JSON.stringify(plan, null, 2));

    if (plan.type === "text") {
      return plan.response;
    }

    // If the planner wants to execute tools
    if (plan.type === "tool" && plan.steps) {
      const result = await executePlan({
        messages: contextMessages,
        plan
      });
      let evaluation = { success: true, reason: "Reflection skipped" };
      if (REFLECTION_ENABLED) {
        try {
          evaluation = await reflect(normalizedQuery, result);
        } catch (reflectError) {
          console.log("Reflection skipped due error:", reflectError?.message || reflectError);
        }
      }

      if(!evaluation.success){
        console.log("Reflection evaluation failed:", evaluation.reason);

        if (shouldAttemptResearchSynthesis(result, evaluation)) {
          const synthesized = await subAgent({
            name: "research synthesis agent",
            instructions: normalizedQuery,
            outputs: [result],
            capabilities: []
          });
          console.log("Synthesis result after reflection:", synthesized);
          return formatAgentResult(synthesized, normalizedQuery);
        }

        const newPlan = await planner({
          messages: contextMessages,
          userQuery: `The previous plan failed because: ${evaluation.reason}. Create a better tool plan for the original user request: ${normalizedQuery}`
        });
        console.log("New Plan after reflection:");
        console.log(JSON.stringify(newPlan, null, 2));
        const retryResult = await executePlan({
          messages: contextMessages,
          plan: newPlan
        });
        console.log("Result of new plan execution:", retryResult);
        return formatAgentResult(retryResult, normalizedQuery);
      } 


      console.log("Final Result:", result);
      return formatAgentResult(result, normalizedQuery);
    }

    return "No action required.";

  } catch (error) {
    console.error("Agent Error:", error);
    const cleanMessage = stripAnsi(String(error?.message || "Agent failed"));
    return `Error: ${cleanMessage}`;
  }
}

export { buildPlannerMessages };


// import OpenAI from "openai";
// import { execSync } from "node:child_process";
// import { z } from "zod";
// import { type } from "node:os";
// import { zodTextFormat } from "openai/helpers/zod";
// import fetch from "node-fetch";
// import nodemailer from "nodemailer";
// import dotenv from "dotenv";
// import { planner } from "./planner.js";
// import { executePlan } from "./executor.js";
// import { memory } from "./memory.js";

// dotenv.config();

// const openai = new OpenAI({
//   apiKey: process.env.OPENAI_API_KEY,
//   baseURL: "https://api.groq.com/openai/v1",
// });
// const SYSTEM_PROMPT = `You are an expert AI assistant that can perform various tasks based on user queries. A
// nalyze the user's query and determine the best course of action to provide a helpful response. If the query is ambiguous,
//  ask clarifying questions to better understand the user's intent.
//  Tools must be executed sequentially.

// Never embed tool calls inside parameters.

// If information is needed before another tool,
// first call the tool to retrieve the information,
// then call the next tool using the result.
//  Never embed tool calls inside parameters.
// Always execute tools step-by-step. fisrt execute one tool the other then other .
//  plan the steps to solve the user's query, and execute them in a logical order. If you need to access external resources or APIs, do so efficiently and effectively. Always aim to provide accurate and relevant information to the user, and be concise in your responses. If you encounter any issues or uncertainties, communicate them clearly to the user and seek additional information if necessary. Your goal is to assist the user in achieving their desired outcome while ensuring a positive user experience.
//  you can create commands to execute tasks, and you can also create sub-agents to handle specific subtasks if needed.
//  you can sent emails, execute commands in the system terminal, perform web searches, access external APIs, and create sub-agents to handle specific subtasks.
//   Always keep the user's needs and preferences in mind when making decisions and providing assistance.
//  Only call tools when absolutely necessary. 
// Do not repeat tool calls if the previous tool call succeeded.
// If a tool returns success: true, do not call it again unless required.
//  and you can execute any command or create any sub-agent as you see fit to achieve t
//  he best results for the user. Always prioritize the user's satisfaction and strive to exceed their expectations in every interaction.
//  available tools :
//  -sentEmail: This tool allows you to send an email to a specified recipient with a given subject and message body. You can use this tool to communicate with others, share information, or provide updates.
//  -executeCommand: This tool allows you to execute a command in the system terminal and retrieve the output. You can use this tool to perform various tasks such as fetching data, running scripts, or accessing system information.
//  -subAgent: This tool allows you to create and manage sub-agents to handle specific subtasks. You can use this tool to delegate tasks to specialized agents.
//  -searchWeb: This tool enables you to perform web searches to gather information on a wide range of topics. You can use this tool to find answers to questions, research specific subjects, or stay updated on current events.
//  -accessAPI: This tool allows you to interact with external APIs to retrieve data or perform actions. You can use this tool to access various services, such as weather forecasts, news updates, or social media platforms.
//  example of a command:
 
//  {
//     "command": "searchWeb",
//     "args": {
//         "query": "What is the capital of France?"
//     }
// }

//  example of a subAgent:
//  {
//     "sub_agent": "weather_agent",
//     "args": {
//         "location": "New York"
//     }
// }

// `;



// const outputSchema = z.object({
//   type: z
//     .enum(["tool_calls", "text"])
//     .describe(
//       'The type of the output, which can be either "tool_call" for tool calls or "text" for text responses.',
//     ),
//   finaloutput: z.boolean().describe("if this is final oout of the chat "),
//   text_content: z
//     .string()
//     .optional()
//     .nullable()
//     .describe(
//       'The text content of the output, which is present when the type is "text".',
//     ),
//   tool_calls: z
//     .array(
//       z.object({
//         tool_name: z
//           .string()
//           .describe(
//             "The name of the tool to be called, which can be one of the available tools.",
//           ),
//         params: z
//            .any()
//           .describe(
//             "The parameters to be passed to the tool, which can vary based on the specific tool being called.",
//           ),
//       }),
//     )
//     .describe(
//       "The specific tool to be called, which can be one of the available tools.",
//     )
//     .optional()
//     .nullable()
//     .describe(
//       "The specific tool to be called, which can be one of the available tools.",
//     ),
// });

// export async function agent(query = "") {
  
// const messages = [{ role: "system", content: SYSTEM_PROMPT }];

//   messages.push({ role: "user", content: query });
//   const MAX_STEPS = 5;

// for (let step = 0; step < MAX_STEPS; step++) {
//     try {
//       const result = await openai.responses.parse({
//         model: "meta-llama/llama-4-scout-17b-16e-instruct",
//         input: messages,
//         text: {
//           format: zodTextFormat(outputSchema, "output"),
//         },
//       });
//       const parsedOutput = result.output_parsed;
//       if (!parsedOutput) {
//         throw new Error("Model returned empty parsed output");
//       }
//       messages.push({
//         role: "assistant",
//         content: JSON.stringify(parsedOutput),
//       });
//       switch (parsedOutput.type) {
//         case "text":
//           if (parsedOutput.finaloutput) {
//     console.log("Agent response:", parsedOutput.text_content);
//     return parsedOutput.text_content;
//   }
//           {
//             console.log("Agent response: ", parsedOutput.text_content);
//           }
//           break;
//         case "tool_calls":
//           {
//             if (parsedOutput.tool_calls) {
//               for (const call of parsedOutput.tool_calls) {
//                 const { tool_name, params } = call;
//                 console.log(
//                   `Executing tool: ${tool_name} with params: ${params}`,
//                 );
//                   if (!toolFunctions[tool_name]) {
                    
//         console.log("Unknown tool:", tool_name);
//         continue;
//       }
//            let parsedParams;

// try {
//   parsedParams = typeof params === "string" ? JSON.parse(params) : params;
// } catch (err) {
//   parsedParams = params;
// }
//                   const toolResult =  await toolFunctions[tool_name](parsedParams);
                
//                 console.log("Tool result:", toolResult);
//                 messages.push({
//                   role: "assistant",
//                   content: JSON.stringify({
//                     tool_name,
//                     params,
//                     toolResult,
//                   }),
//                 });
            
//                 if (!toolResult.success) {
//                   console.log("Tool failed. Retrying...");
//                 }
//               }
//             }
//             continue;
//           }
         
         
//       }
//       if (parsedOutput.finaloutput) {
//         console.log("Final output received. Ending agent execution.");
//         return parsedOutput.text_content || "No final text content provided.";
//       }
//     } catch (error) {
//       console.error("Error occurred: ", error);
//       break;
//     }
//   }
// }



// //  import readline from "node:readline";

// // const rl = readline.createInterface({
// //   input: process.stdin,
// //   output: process.stdout,
// // });
// // export async function startChat() {
// //   console.log("Agent started. Type 'exit' to quit.\n");

// //   rl.on("line", async (input) => {
// //     if (input.toLowerCase() === "exit") {
// //       console.log("");
// //       process.exit(0);
// //     }

// //     try {
// //       const response = await agent(input);
// //       console.log("\nAgent:", response, "\n");
// //     } catch (err) {
// //       console.error("Error:", err);
// //     }
// //   });
// // }
