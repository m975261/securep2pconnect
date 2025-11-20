import { motion, AnimatePresence } from "framer-motion";
import { Send, Mic, Paperclip, File as FileIcon, X } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";

interface Message {
  id: string;
  text: string;
  sender: "me" | "peer";
  timestamp: Date;
  type: "text" | "file";
  fileInfo?: {
    name: string;
    size: string;
  };
}

export function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      text: "Secure connection established.",
      sender: "peer",
      timestamp: new Date(),
      type: "text"
    }
  ]);
  const [inputValue, setInputValue] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [messages]);

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;

    const newMessage: Message = {
      id: Date.now().toString(),
      text: inputValue,
      sender: "me",
      timestamp: new Date(),
      type: "text"
    };

    setMessages(prev => [...prev, newMessage]);
    setInputValue("");

    // Simulate reply
    setTimeout(() => {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        text: "Received loud and clear.",
        sender: "peer",
        timestamp: new Date(),
        type: "text"
      }]);
    }, 1500);
  };

  return (
    <div className="flex flex-col h-full bg-black/40 backdrop-blur-sm rounded-xl border border-white/5 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-white/5 flex justify-between items-center bg-black/20">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          <span className="text-xs font-mono text-muted-foreground">ENCRYPTED CHANNEL</span>
        </div>
        <div className="text-xs font-mono text-muted-foreground opacity-50">
          P2P-WEBRTC-V2
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <motion.div
            key={msg.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex ${msg.sender === "me" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] p-3 rounded-lg text-sm font-mono ${
                msg.sender === "me"
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "bg-white/5 text-white/80 border border-white/10"
              }`}
            >
              {msg.type === "text" ? (
                msg.text
              ) : (
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-black/30 rounded">
                    <FileIcon className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-bold">{msg.fileInfo?.name}</div>
                    <div className="text-xs opacity-60">{msg.fileInfo?.size}</div>
                  </div>
                </div>
              )}
              <div className="text-[10px] opacity-30 mt-1 text-right">
                {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </motion.div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={sendMessage} className="p-4 border-t border-white/5 bg-black/40">
        <div className="flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Type secure message..."
            className="flex-1 bg-black/50 border border-white/10 rounded-md px-4 py-2 text-sm font-mono focus:outline-none focus:border-primary/50 transition-colors"
          />
          <button
            type="submit"
            className="p-2 bg-primary/10 text-primary border border-primary/20 rounded-md hover:bg-primary/20 transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </form>
    </div>
  );
}
