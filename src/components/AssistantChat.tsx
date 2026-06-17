import React, { useState, useRef, useEffect } from "react";
import { Note } from "../types";
import { Send, Heart, Sparkles, MessageSquare, Hourglass } from "lucide-react";

interface AssistantChatProps {
  notes: Note[];
  onSuggestedNote: (noteDraft: { title: string; content: string; priority: "high" | "medium" | "low"; date: string; tags: string[] }) => void;
  userName: string;
}

interface Message {
  id: string;
  sender: "user" | "assistant";
  text: string;
  timestamp: Date;
  suggestedNote?: {
    title: string;
    content: string;
    priority: "high" | "medium" | "low";
    date: string;
    tags: string[];
  };
}

export default function AssistantChat({ notes, onSuggestedNote, userName }: AssistantChatProps) {
  const nameToUse = userName.trim() || "Usuario";
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      sender: "assistant",
      text: `Hola, ${nameToUse}. Bienvenido/a a su Asistente Virtual de Recordatorios. Estoy a su disposición para ayudarle a programar, agendar y enviar alertas de sus tareas directamente a WhatsApp.\n\n¿Qué pendiente o recordatorio desea programar o revisar en este momento?`,
      timestamp: new Date()
    }
  ]);
  const [inputMsg, setInputMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // If userName changes, refresh welcome message text to feel personalized
  useEffect(() => {
    setMessages(prev => prev.map(m => {
      if (m.id === "welcome") {
        return {
          ...m,
          text: `Hola, ${nameToUse}. Bienvenido/a a su Asistente Virtual de Recordatorios. Estoy a su disposición para ayudarle a programar, agendar y enviar alertas de sus tareas directamente a WhatsApp.\n\n¿Qué pendiente o recordatorio desea programar o revisar en este momento?`
        };
      }
      return m;
    }));
  }, [nameToUse]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMsg.trim() || loading) return;

    const userText = inputMsg.trim();
    const newUserMsg: Message = {
      id: Math.random().toString(),
      sender: "user",
      text: userText,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, newUserMsg]);
    setInputMsg("");
    setLoading(true);

    try {
      // Map notes briefly to feed metadata to Gemini
      const notesHistory = notes.map(n => ({
        titulo: n.title,
        descripcion: n.content,
        prioridad: n.priority,
        fecha: n.date,
        etiquetas: n.tags,
        sincronizadoWhatsApp: n.whatsappStatus
      }));

      const d = new Date();
      const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

      const res = await fetch("/api/gemini/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userText,
          notesHistory,
          userName: nameToUse,
          currentDate: todayStr,
          chatHistory: messages.map(m => ({ sender: m.sender, text: m.text }))
        })
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Fallo la respuesta de tu hijo favorito.");
      }

      const data = await res.json();

      const assistantMsg: Message = {
        id: Math.random().toString(),
        sender: "assistant",
        text: data.response || "No logré captar la idea. ¿Podrías repetirlo?",
        timestamp: new Date(),
        suggestedNote: data.suggestedNote
      };

      setMessages(prev => [...prev, assistantMsg]);

      // Automatically import/schedule the task without requiring human clicks
      if (data.suggestedNote) {
        onSuggestedNote(data.suggestedNote);
      }
    } catch (error: any) {
      console.error(error);
      setMessages(prev => [
        ...prev,
        {
          id: Math.random().toString(),
          sender: "assistant",
          text: `⚠️ ${nameToUse}, ocurrió un inconveniente: ${error.message || "Revisa tu conexión o configuración de Gemini."}`,
          timestamp: new Date()
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const tryImportSuggestedNote = (draft: { title: string; content: string; priority: "high" | "medium" | "low"; date: string; tags: string[] }) => {
    onSuggestedNote(draft);
  };

  return (
    <div className="bg-slate-900 text-white rounded-2xl shadow-xl flex flex-col overflow-hidden h-[540px] border border-slate-800 transition-all">
      {/* Bot Chat Header */}
      <div className="bg-gradient-to-r from-indigo-700 via-indigo-850 to-indigo-950 px-4 py-3.5 flex items-center justify-between border-b border-indigo-950">
        <div className="flex items-center space-x-3">
          <div className="relative">
            <div className="w-10 h-10 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-700 font-bold border-2 border-indigo-400 shadow-md">
              <span className="text-xl">📋</span>
            </div>
            <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-400 rounded-full border-2 border-slate-900" />
          </div>
          <div>
            <h4 className="text-sm font-semibold flex items-center">
              Asistente Virtual
              <Heart className="w-3.5 h-3.5 ml-1.5 text-rose-400 fill-rose-400 animate-pulse" />
            </h4>
            <span className="text-[11px] text-indigo-200">En línea para organizar sus tareas</span>
          </div>
        </div>
        <div className="text-xxs bg-indigo-950/80 border border-indigo-900 px-2.5 py-1 rounded-full text-indigo-200 font-medium">
          Servicio Activo
        </div>
      </div>

      {/* Messages Window */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${msg.sender === "user" ? "items-end" : "items-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs ${
                msg.sender === "user"
                  ? "bg-indigo-600 text-white rounded-tr-none"
                  : "bg-slate-800 text-slate-100 rounded-tl-none border border-slate-700/60"
              }`}
            >
              <div className="whitespace-pre-wrap leading-relaxed">{msg.text}</div>
              
               {/* Automated Import status indicators */}
              {msg.sender === "assistant" && msg.suggestedNote && (
                <div className="mt-3 pt-2 border-t border-slate-750 flex justify-end">
                  <div className="text-xxs text-emerald-400 font-bold flex items-center space-x-1.5 bg-slate-950/75 border border-emerald-950 px-3.5 py-2 rounded-xl shadow-sm animate-fade-in select-none">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span>⏰ Alerta programada automáticamente ({
                      msg.suggestedNote.priority === "high" ? "🔴 Alta" :
                      msg.suggestedNote.priority === "medium" ? "🟡 Media" : "🟢 Baja"
                    })</span>
                  </div>
                </div>
              )}
            </div>
            <span className="text-xxs text-slate-500 mt-0.5 px-1 font-mono">
              {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-slate-800 rounded-2xl rounded-tl-none px-4 py-2.5 border border-slate-700 flex items-center space-x-2 text-xs text-slate-400">
              <Hourglass className="w-3.5 h-3.5 animate-spin text-indigo-400" />
              <span>El asistente está procesando su solicitud...</span>
            </div>
          </div>
        )}
        <div ref={scrollRef} />
      </div>

      {/* Input box */}
      <form onSubmit={handleSendMessage} className="bg-slate-950 p-2.5 border-t border-slate-800 flex space-x-2">
        <input
          type="text"
          value={inputMsg}
          onChange={(e) => setInputMsg(e.target.value)}
          placeholder="Escribe eg: Redacta un recordatorio para comprar medicina..."
          className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 text-white placeholder-slate-500"
        />
        <button
          type="submit"
          className="bg-indigo-600 hover:bg-indigo-700 text-white p-2 rounded-lg transition-colors flex items-center justify-center disabled:opacity-50"
          disabled={!inputMsg.trim() || loading}
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}
