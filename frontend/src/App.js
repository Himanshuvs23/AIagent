import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

const API_BASE =
  process.env.REACT_APP_API_BASE_URL?.replace(/\/$/, "") ||
  "http://localhost:8001";

const EMPTY_CHAT_TITLE = "New Chat";

function createDraftChat() {
  return {
    _id: null,
    title: EMPTY_CHAT_TITLE,
    messages: []
  };
}

function normalizeAssistantMessage(payload) {
  const raw =
    payload?.message ??
    payload?.messages ??
    payload?.response ??
    payload?.data;

  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry.content === "string") return entry.content;
        return "";
      })
      .filter(Boolean)
      .join("\n\n");
  }
  if (raw && typeof raw === "object") {
    if (typeof raw.content === "string") return raw.content;
    try {
      return JSON.stringify(raw, null, 2);
    } catch {
      return String(raw);
    }
  }
  if (typeof payload?.error === "string") {
    return payload.details
      ? `Error: ${payload.error}\n${payload.details}`
      : `Error: ${payload.error}`;
  }
  return "No response from server.";
}

function renderMessageText(content) {
  const text = String(content ?? "");
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);

  return parts.map((part, index) => {
    if (/^https?:\/\/[^\s]+$/.test(part)) {
      return (
        <a
          key={`${part}-${index}`}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="link"
        >
          {part}
        </a>
      );
    }

    return <React.Fragment key={`text-${index}`}>{part}</React.Fragment>;
  });
}

function MessageContent({ content }) {
  const [expanded, setExpanded] = useState(false);
  const text = String(content ?? "");
  const lines = text.split("\n");
  const isLong = text.length > 1800 || lines.length > 20;
  const previewText =
    isLong && !expanded
      ? `${lines.slice(0, 20).join("\n")}\n\n[Preview truncated. Expand to read the full response.]`
      : text;

  return (
    <>
      <div className="messageText">{renderMessageText(previewText)}</div>
      {isLong ? (
        <button
          type="button"
          className="messageToggle"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Show less" : "Show full response"}
        </button>
      ) : null}
    </>
  );
}

function App() {
  const [query, setQuery] = useState("");
  const [chats, setChats] = useState([]);
  const [currentChatIndex, setCurrentChatIndex] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState("");
  const chatBoxRef = useRef(null);

  const currentMessages = useMemo(
    () => (currentChatIndex !== null ? chats[currentChatIndex]?.messages ?? [] : []),
    [chats, currentChatIndex]
  );

  useEffect(() => {
    const chatBox = chatBoxRef.current;
    if (chatBox) {
      chatBox.scrollTop = chatBox.scrollHeight;
    }
  }, [currentMessages, loadingStage]);

  async function loadMessages(chatId, index) {
    setCurrentChatIndex(index);

    try {
      const res = await fetch(`${API_BASE}/api/messages/${chatId}`);
      if (!res.ok) {
        throw new Error(`Failed to load messages (${res.status})`);
      }

      const data = await res.json();

      setChats((prevChats) =>
        prevChats.map((chat, chatIndex) =>
          chatIndex === index
            ? { ...chat, messages: Array.isArray(data) ? data : [] }
            : chat
        )
      );
    } catch (error) {
      console.error(error);
    }
  }

  useEffect(() => {
    let isActive = true;

    async function fetchChats() {
      try {
        const res = await fetch(`${API_BASE}/api/conversations`);
        if (!res.ok) {
          throw new Error(`Failed to load conversations (${res.status})`);
        }

        const data = await res.json();
        const formatted = data.map((chat) => ({
          _id: chat._id,
          title: chat.title,
          messages: []
        }));

        if (!isActive) {
          return;
        }

        setChats(formatted);

        if (formatted.length > 0 && formatted[0]._id) {
          loadMessages(formatted[0]._id, 0);
        }
      } catch (error) {
        console.error(error);
      }
    }

    fetchChats();

    return () => {
      isActive = false;
    };
  }, []);

  function startNewChat() {
    setChats((prevChats) => {
      const existingDraftIndex = prevChats.findIndex(
        (chat) => !chat._id && (chat.messages?.length ?? 0) === 0
      );

      if (existingDraftIndex !== -1) {
        setCurrentChatIndex(existingDraftIndex);
        return prevChats;
      }

      const nextChats = [...prevChats, createDraftChat()];
      setCurrentChatIndex(nextChats.length - 1);
      return nextChats;
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;

    const userMessage = { role: "user", content: trimmedQuery };
    let activeIndex = currentChatIndex;

    if (activeIndex === null) {
      activeIndex = chats.length;
      setCurrentChatIndex(activeIndex);
      setChats((prevChats) => [...prevChats, createDraftChat()]);
    }

    setChats((prevChats) => {
      const nextChats = [...prevChats];
      const chat = nextChats[activeIndex] ?? createDraftChat();
      const nextTitle =
        !chat.title || chat.title === EMPTY_CHAT_TITLE
          ? trimmedQuery.slice(0, 40)
          : chat.title;

      nextChats[activeIndex] = {
        ...chat,
        title: nextTitle,
        messages: [...(chat.messages ?? []), userMessage]
      };
      return nextChats;
    });

    setQuery("");
    setLoading(true);

    const loadingStages = [
      "AI is thinking...",
      "AI is planning...",
      "AI is using tools when needed...",
      "AI is preparing the final answer..."
    ];

    let stageIndex = 0;
    setLoadingStage(loadingStages[stageIndex]);
    const stageTimer = setInterval(() => {
      stageIndex = Math.min(stageIndex + 1, loadingStages.length - 1);
      setLoadingStage(loadingStages[stageIndex]);
    }, 1200);

    try {
      const activeChat = chats[activeIndex];
      const response = await fetch(`${API_BASE}/api/agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: trimmedQuery,
          chatId: activeChat?._id ?? null
        })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(normalizeAssistantMessage(data) || `Request failed (${response.status})`);
      }

      const aiMessage = {
        role: "assistant",
        content: normalizeAssistantMessage(data)
      };

      setChats((prevChats) => {
        const nextChats = [...prevChats];
        const chat = nextChats[activeIndex] ?? createDraftChat();

        nextChats[activeIndex] = {
          ...chat,
          _id: data.chatId ?? chat._id,
          title:
            chat.title && chat.title !== EMPTY_CHAT_TITLE
              ? chat.title
              : trimmedQuery.slice(0, 40),
          messages: [...(chat.messages ?? []), aiMessage]
        };

        return nextChats;
      });
    } catch (error) {
      console.error(error);

      const errorMessage = {
        role: "assistant",
        content: error.message || "Something went wrong while contacting the server."
      };

      setChats((prevChats) => {
        const nextChats = [...prevChats];
        const chat = nextChats[activeIndex] ?? createDraftChat();

        nextChats[activeIndex] = {
          ...chat,
          messages: [...(chat.messages ?? []), errorMessage]
        };

        return nextChats;
      });
    } finally {
      clearInterval(stageTimer);
      setLoading(false);
      setLoadingStage("");
    }
  }

  return (
    <div className="app">
      <div className="sidebar">
        <h3>Chats</h3>

        <button className="newChatButton" onClick={startNewChat}>
          + New Chat
        </button>

        <div className="chatList">
          {chats.map((chat, index) => (
            <div
              key={chat._id || `draft-${index}`}
              className={index === currentChatIndex ? "activeChat" : "chatItem"}
              onClick={() => {
                if (!chat._id) {
                  setCurrentChatIndex(index);
                  return;
                }

                loadMessages(chat._id, index);
              }}
            >
              {chat.title || `Chat ${index + 1}`}
            </div>
          ))}
        </div>
      </div>

      <div className="container">
        <h1>
          Intelligent Assistant{" "}
          <span>
            <img src="/bot.png" alt="logo" height="70" className="icon" />
          </span>
        </h1>

        <div className="chatBox" ref={chatBoxRef}>
          {currentMessages.map((msg, index) => (
            <div
              key={`${msg.role}-${index}-${msg.createdAt || ""}`}
              className={msg.role === "user" ? "userMessage" : "aiMessage"}
            >
              <MessageContent content={msg.content} />
            </div>
          ))}

          {loading ? <p className="statusMessage">{loadingStage}</p> : null}
        </div>

        <form onSubmit={handleSubmit} className="form">
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Ask something..."
            className="input"
          />

          <button type="submit" className="button" disabled={loading}>
            {loading ? "Working..." : "Send"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default App;
