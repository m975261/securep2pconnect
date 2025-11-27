import { motion, AnimatePresence } from "framer-motion";
import { Send, Mic, Paperclip, File as FileIcon, X } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";

interface Message {
  id: string;
  text: string;
  sender: "me" | "peer";
  timestamp: Date;
  senderName?: string;
}

interface ChatInterfaceProps {
  messages: Message[];
  onSendMessage: (text: string) => void;
  peerNickname?: string;
  connectionState?: string;
}

export function ChatInterface({ messages, onSendMessage, peerNickname, connectionState }: ChatInterfaceProps) {
  const [inputValue, setInputValue] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [messages]);

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;

    onSendMessage(inputValue);
    setInputValue("");
  };

  return (
    <div className="flex flex-col h-full bg-black/40 backdrop-blur-sm rounded-xl border border-white/5 overflow-hidden">
      <div className="p-2 border-b border-white/5 bg-black/20">
        <div className="flex justify-between items-center mb-1.5">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <span className="text-xs font-mono text-muted-foreground">ENCRYPTED CHANNEL</span>
          </div>
          <div className="text-xs font-mono text-muted-foreground opacity-50">
            P2P-WEBRTC-V2
          </div>
        </div>
        {peerNickname && connectionState === 'connected' && (
          <div className="flex items-center gap-2 px-2 py-1 bg-primary/5 border border-primary/20 rounded-md" data-testid="peer-status">
            <div className="w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_8px_rgba(0,255,157,0.5)] animate-pulse" />
            <span className="text-[11px] font-mono text-primary/90">
              {peerNickname}
            </span>
            <span className="text-[10px] font-mono text-primary/50">
              • CONNECTED
            </span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {messages.map((msg) => (
          <motion.div
            key={msg.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex flex-col ${msg.sender === "me" ? "items-end" : "items-start"}`}
          >
            <span className={`text-[10px] font-mono font-semibold mb-1 px-1 ${
              msg.sender === "me" ? "text-primary" : "text-white/70"
            }`} data-testid={`label-${msg.sender}-nickname`}>
              {msg.senderName || (msg.sender === "me" ? "You" : "Peer")}
            </span>
            <div
              className={`max-w-[80%] p-2 rounded-lg text-sm font-mono ${
                msg.sender === "me"
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "bg-white/5 text-white/80 border border-white/10"
              }`}
            >
              {msg.text}
              <div className="text-[10px] opacity-30 mt-0.5 text-right">
                {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </motion.div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={sendMessage} className="p-2 border-t border-white/5 bg-black/40">
        <div className="flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Type secure message..."
            className="flex-1 bg-black/50 border border-white/10 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:border-primary/50 transition-colors"
            data-testid="input-message"
          />
          <button
            type="submit"
            className="p-2 bg-primary/10 text-primary border border-primary/20 rounded-md hover:bg-primary/20 transition-colors"
            data-testid="button-send"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </form>
    </div>
  );
}
