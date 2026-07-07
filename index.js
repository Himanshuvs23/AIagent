import express from "express";
import cors from "cors";
import { agent } from "./agent.js";
import { upload } from "./agent/middleware.js";
import { connectDB } from "./agent/libs/db.js";
import { Conversation, Message } from "./agent/model/chat.js";
import { getMemoryContext, updateMemoryFromTurn } from "./agent/memory.js";

const app = express();

function normalizeResponseMessage(result) {
  if (typeof result === "string") return result;
  if (result === null || result === undefined) return "No response from AI";
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 8001;

app.get("/", (req, res) => {
  res.send("Backend server is running this is backend ");
});

app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  res.json({
    message: "file uploaded successfully",
    url: req.file.path,
    filename: req.file.filename
  });
});

app.get("/api/conversations", async (req, res) => {
  try {
    await connectDB();

    const conversations = await Conversation.find()
      .sort({ updatedAt: -1 });

    res.json(conversations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/messages/:chatId", async (req, res) => {
  try {
    await connectDB();

    const messages = await Message.find({
      chatId: req.params.chatId 
    }).sort({ createdAt: 1 });

    res.json(messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
      createdAt: msg.createdAt,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/agent", async (req, res) => {
  console.log("BODY:", req.body);
  try {
    await connectDB();

    const rawMessage =
      req.body?.message ??
      req.body?.query ??
      req.body?.messages?.[0] ??
      req.body?.message?.[0];

    const message =
      typeof rawMessage === "string"
        ? rawMessage
        : rawMessage?.content ?? null;

    if (!message) {
      return res.status(400).json({
        error: "Message is required"
      });
    }

    let { chatId } = req.body;

    if (!chatId) {
      const convo = await Conversation.create({
        title: message.slice(0, 60)
      });
      chatId = convo._id;
    }

    await Message.create({
      chatId,
      role: "user",
      content: message,
    });

    const history = await Message.find({ chatId })
      .sort({ createdAt: 1 })
      .limit(20);

    const formattedHistory = history.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    const memoryContext = await getMemoryContext({ chatId });

    const result = await agent({
      messages: [...memoryContext, ...formattedHistory],
      input: message
    });

    if (!result) {
      return res.status(502).json({
        error: "Agent returned an empty response"
      });
    }

    let aiResponse = normalizeResponseMessage(result);
    console.log("AI Response:", aiResponse);

    if (!aiResponse || aiResponse.trim() === "") {
      aiResponse = "AI could not generate a response.";
    }

    await Message.create({
      chatId,
      role: "assistant",
      content: aiResponse,
    });

    await updateMemoryFromTurn({
      chatId,
      messages: [
        ...formattedHistory,
        { role: "assistant", content: aiResponse }
      ],
      latestUserMessage: message,
      latestAssistantMessage: aiResponse
    }).catch((memoryError) => {
      console.error("Memory update failed:", memoryError.message);
    });

    await Conversation.findByIdAndUpdate(chatId, {
      updatedAt: new Date()
    });

    res.json({
      success: true,
      message: aiResponse,
      messages: aiResponse,
      chatId
    });
  } catch (error) {
    console.error("API Error:", error);
    res.status(500).json({
      error: "Agent failed",
      details: error.message
    });
  }
});

connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to connect to database:", error.message);
    process.exit(1);
  });
