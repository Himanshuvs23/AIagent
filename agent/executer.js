import { sentEmail, executeCommand, subAgent, searchWeb, accessAPI , mathTool , createFile , openApplication , sendTelegramMessage} from "./tools.js";

const toolFunctions = {
  executeCommand,
  createFile,
  openApplication,
  subAgent,
  mathTool,
  searchWeb,
  accessAPI,
  sentEmail,
  sendTelegramMessage,
  sendEmail: sentEmail // alias if planner uses this name
};

function resolvePreviousResultPlaceholders(value, previousResult) {
  if (value === "{previous_result}" || value === "previous_result") {
    return previousResult;
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolvePreviousResultPlaceholders(item, previousResult));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        resolvePreviousResultPlaceholders(item, previousResult)
      ])
    );
  }
  return value;
}

export async function executePlan({ plan }) {

  let previousResult = "";

  if (!plan.steps || plan.steps.length === 0) {
  return plan.response || "No steps to execute.";
}

  for (const step of plan.steps) {

    const tool = toolFunctions[step.tool];

    if (!tool) {
      throw new Error(`Tool not found: ${step.tool}`);
    }
    const args = resolvePreviousResultPlaceholders(
      step.args && typeof step.args === "object" ? step.args : {},
      previousResult
    );

    console.log("Executing tool:", step.tool);
    console.log("Args:", args);

    const result = await tool(args);

    console.log("Tool result:", result);

    previousResult = result;


    if (result && typeof result === "object" && result.success === false) {
      return result;
    }
  }

  return previousResult;
}
