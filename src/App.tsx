import React, { useState, useEffect } from "react";
import { 
  Plus, 
  Tag, 
  Trash2, 
  Heart, 
  Send, 
  Settings, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  Sparkles, 
  LogOut, 
  Search, 
  Bookmark,
  Smartphone
} from "lucide-react";
import { Note, WhatsAppConfig, SimulationLog } from "./types";
import AssistantChat from "./components/AssistantChat";

// Firebase Imports
import { db, auth, googleProvider, OperationType, handleFirestoreError } from "./lib/firebase";
import { 
  collection, 
  doc, 
  setDoc, 
  deleteDoc, 
  onSnapshot,
  query,
  where
} from "firebase/firestore";
import { 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged,
  User as FirebaseUser
} from "firebase/auth";

export default function App() {
  // Authentication states
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // States
  const [notes, setNotes] = useState<Note[]>([]);
  const [notesLoading, setNotesLoading] = useState(true);

  // User Name - Defaults to empty or custom username, and autodetected from active account
  const [userName, setUserName] = useState<string>(() => {
    const saved = localStorage.getItem("tu_hijo_favorito_user_name");
    return saved && saved !== "Julio" ? saved : "";
  });

  // WhatsApp Send Method: "direct" (for fast wa.me links) or "api" (for business API)
  const [whatsappSendMethod, setWhatsappSendMethod] = useState<"direct" | "api">(() => {
    return (localStorage.getItem("tu_hijo_favorito_whatsapp_send_method") as "direct" | "api") || "direct";
  });

  // WhatsApp Credentials State
  const [whatsappPhoneId, setWhatsappPhoneId] = useState<string>(() => {
    return localStorage.getItem("tu_hijo_favorito_whatsapp_phone_id") || "";
  });
  const [whatsappToken, setWhatsappToken] = useState<string>(() => {
    return localStorage.getItem("tu_hijo_favorito_whatsapp_token") || "";
  });
  const [whatsappRecipient, setWhatsappRecipient] = useState<string>(() => {
    return localStorage.getItem("tu_hijo_favorito_whatsapp_recipient") || "";
  });
  const [configLoading, setConfigLoading] = useState(false);
  const [showConfig, setShowConfig] = useState(false);

  // Settings minimized state
  const [isSettingsMinimized, setIsSettingsMinimized] = useState<boolean>(() => {
    const savedRecipient = localStorage.getItem("tu_hijo_favorito_whatsapp_recipient");
    if (!savedRecipient) {
      return false; // Show maximized on first load if WhatsApp not configured yet
    }
    return (localStorage.getItem("tu_hijo_favorito_settings_minimized") || "true") === "true";
  });

  // Simulation log list
  const [simulationLogs, setSimulationLogs] = useState<SimulationLog[]>([]);
  const [isSendingWhatsApp, setIsSendingWhatsApp] = useState<string | null>(null);

  // Quick state to display temporary save success notification
  const [successMemo, setSuccessMemo] = useState<string | null>(null);

  // State for active due reminder popup modal
  const [activeDueNote, setActiveDueNote] = useState<Note | null>(null);

  // Dynamic real-time updating system clock for background checker & UI indicator
  const [currentSystemTime, setCurrentSystemTime] = useState<Date>(new Date());

  useEffect(() => {
    const clockTimer = setInterval(() => {
      setCurrentSystemTime(new Date());
    }, 1000);
    return () => clearInterval(clockTimer);
  }, []);

  // Robust helper to parse scheduled HH:MM time from note content and pad it to strictly 5 characters (e.g. "09:00" or "18:30")
  const parseNoteTime = (content: string): string | null => {
    if (!content) return null;
    // 1. Try to match the official structured label first (e.g., "⏰ Programado a las 18:30" or "Programado...")
    const structuredMatch = content.match(/(?:Programado a las|⏰ Programado a las)\s*(\d{1,2}):(\d{2})/i);
    if (structuredMatch) {
      const hr = structuredMatch[1].padStart(2, "0");
      const min = structuredMatch[2].padStart(2, "0");
      return `${hr}:${min}`;
    }
    // 2. Fallback to any standalone time notation (HH:MM or H:MM) present in the note
    const genericMatch = content.match(/(\d{1,2}):(\d{2})/);
    if (genericMatch) {
      const hr = genericMatch[1].padStart(2, "0");
      const min = genericMatch[2].padStart(2, "0");
      return `${hr}:${min}`;
    }
    return null;
  };

  // Synthesizer beep and sound chime helper
  const playChimeSound = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const playTone = (freq: number, start: number, duration: number) => {
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, start);
        gainNode.gain.setValueAtTime(0.25, start);
        gainNode.gain.exponentialRampToValueAtTime(0.001, start + duration);
        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        osc.start(start);
        osc.stop(start + duration);
      };
      
      const now = audioCtx.currentTime;
      playTone(523.25, now, 0.35); // C5
      playTone(659.25, now + 0.12, 0.45); // E5
    } catch (e) {
      console.warn("Chime playback error:", e);
    }
  };

  // Track name and configuration updates
  useEffect(() => {
    localStorage.setItem("tu_hijo_favorito_user_name", userName);
  }, [userName]);

  useEffect(() => {
    localStorage.setItem("tu_hijo_favorito_whatsapp_recipient", whatsappRecipient);
  }, [whatsappRecipient]);

  useEffect(() => {
    localStorage.setItem("tu_hijo_favorito_whatsapp_send_method", whatsappSendMethod);
  }, [whatsappSendMethod]);

  // Track Auth
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setAuthLoading(false);
      if (user) {
        const savedName = localStorage.getItem("tu_hijo_favorito_user_name");
        if (!savedName || savedName === "Julio" || savedName === "") {
          let detectedName = "";
          if (user.displayName) {
            detectedName = user.displayName.split(" ")[0];
          } else if (user.email) {
            const emailPart = user.email.split("@")[0];
            const nameOnly = emailPart.replace(/[0-9_.-]/g, "");
            detectedName = nameOnly.charAt(0).toUpperCase() + nameOnly.slice(1);
          }
          if (detectedName) {
            setUserName(detectedName);
            localStorage.setItem("tu_hijo_favorito_user_name", detectedName);
          }
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // Sync Notes & WhatsApp Config with Firestore once logged in
  useEffect(() => {
    if (!currentUser) {
      setNotes([]);
      setNotesLoading(false);
      return;
    }

    setNotesLoading(true);

    // Dynamic notes listener
    const notesQuery = query(
      collection(db, "notes"),
      where("userId", "==", currentUser.uid)
    );

    const unsubscribeNotes = onSnapshot(notesQuery, (snapshot) => {
      const fetchedNotes: Note[] = [];
      snapshot.forEach((doc) => {
        fetchedNotes.push({ id: doc.id, ...doc.data() } as Note);
      });
      // Sort client side by date descending (then priority high)
      fetchedNotes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      setNotes(fetchedNotes);
      setNotesLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, "notes");
      setNotesLoading(false);
    });

    // WhatsApp Config Fetch
    const configDocRef = doc(db, "whatsappConfigs", currentUser.uid);
    const unsubscribeConfig = onSnapshot(configDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setWhatsappPhoneId(data.phoneNumberId || "");
        setWhatsappToken(data.accessToken || "");
        setWhatsappRecipient(data.recipientNumber || "");
        if (data.sendMethod === "direct" || data.sendMethod === "api") {
          setWhatsappSendMethod(data.sendMethod);
        }
      }
    });

    return () => {
      unsubscribeNotes();
      unsubscribeConfig();
    };
  }, [currentUser]);

  // Automatic Background Reminder Alarm state and hook
  const [autoSendingIds, setAutoSendingIds] = useState<string[]>([]);

  useEffect(() => {
    const runCheck = () => {
      if (notesLoading || notes.length === 0) return;

      const d = new Date();
      const localToday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const localTime = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

      const dueNotes = notes.filter((note) => {
        if (note.whatsappStatus !== "pending") return false;
        if (autoSendingIds.includes(note.id)) return false;
        if (isSendingWhatsApp === note.id) return false;
        if (activeDueNote && activeDueNote.id === note.id) return false;

        // If date is in the past, it's due
        if (note.date < localToday) return true;

        // If today, check if current time is past or equal to scheduled time
        if (note.date === localToday) {
          const noteTime = parseNoteTime(note.content);
          if (noteTime) {
            return localTime >= noteTime;
          }
        }
        return false;
      });

      dueNotes.forEach((note) => {
        const isDirect = whatsappSendMethod === "direct" || !currentUser;
        const isSimulated = !whatsappPhoneId?.trim() || !whatsappToken?.trim();

        if (isDirect || isSimulated) {
          // Play chime sound and open the alert modal so the user gets notified and can click to send, bypassing popup blocking
          setActiveDueNote(note);
          playChimeSound();
          // Register immediately so we don't show the modal repeatedly
          setAutoSendingIds((prev) => [...prev, note.id]);
        } else {
          // Pure API fully-automated delivery in the background
          setAutoSendingIds((prev) => [...prev, note.id]);
          console.log(`[Auto-Trigger API] Enviando de forma automática en segundo plano: ${note.title}`);
          handleSendWhatsAppNotification(note).catch((err) => {
            console.error("Auto dispatch fail:", err);
          });
        }
      });
    };

    // Run once immediately on hook execution to trigger instant due warnings/alarms
    runCheck();

    // Check every 5 seconds for precise actioning
    const timer = setInterval(runCheck, 5000);

    return () => clearInterval(timer);
  }, [notes, notesLoading, autoSendingIds, isSendingWhatsApp, activeDueNote, whatsappRecipient, whatsappPhoneId, whatsappToken, whatsappSendMethod, currentUser]);

  // Handle Google Login
  const handleGoogleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e: any) {
      console.error("Login failed:", e);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (e) {
      console.error("Logout failed:", e);
    }
  };

  // Directly send/schedule a note suggested conversationally by the AI
  const handleSuggestedNoteImport = async (draft: { title: string; content: string; priority: "high" | "medium" | "low"; date: string; tags: string[] }) => {
    const docId = Math.random().toString(36).substring(2, 11);
    const dateStr = new Date().toISOString();

    const dObj = new Date();
    const localToday = `${dObj.getFullYear()}-${String(dObj.getMonth() + 1).padStart(2, "0")}-${String(dObj.getDate()).padStart(2, "0")}`;

    const newNote: Note = {
      id: docId,
      userId: currentUser ? currentUser.uid : "guest",
      title: draft.title,
      content: draft.content,
      priority: draft.priority,
      date: draft.date || localToday,
      tags: draft.tags || ["Asistente"],
      whatsappStatus: "pending",
      whatsappLastSent: null,
      createdAt: dateStr,
      updatedAt: dateStr
    };

    // Check if scheduled time is in the future
    const noteTime = parseNoteTime(draft.content);
    const localTime = `${String(dObj.getHours()).padStart(2, "0")}:${String(dObj.getMinutes()).padStart(2, "0")}`;
    const isForFuture = draft.date && (draft.date > localToday || (draft.date === localToday && noteTime && noteTime > localTime));

    if (currentUser) {
      try {
        // Save silently so the background alarm checker can fire it automatically if they are offline or scheduled for the future
        await setDoc(doc(db, "notes", docId), newNote);
      } catch (err) {
        console.warn("Error guardando recordatorio silencioso en Firestore:", err);
      }
    } else {
      // For guest users, push to state
      setNotes(prev => [newNote, ...prev]);
    }

    if (isForFuture) {
      setSuccessMemo(`⏰ Alerta programada: Se enviará automáticamente el ${draft.date} a las ${noteTime || "la hora programada"}.`);
      setTimeout(() => setSuccessMemo(null), 5000);
    } else {
      setSuccessMemo(`🚀 Alerta inmediata enviada: "${draft.title}".`);
      setTimeout(() => setSuccessMemo(null), 4000);
      
      // Directly trigger WhatsApp dispatch!
      await handleSendWhatsAppNotification(newNote);
    }
  };

  // Delete Note
  const handleDeleteNote = async (id: string) => {
    if (!currentUser) return;
    try {
      await deleteDoc(doc(db, "notes", id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, "notes/" + id);
    }
  };

  // Save WhatsApp Credentials
  const handleSaveWhatsAppConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) {
      alert("Debes iniciar sesión con Google para almacenar credenciales.");
      return;
    }

    setConfigLoading(true);
    try {
      const config = {
        userId: currentUser.uid,
        phoneNumberId: whatsappPhoneId.trim(),
        accessToken: whatsappToken.trim(),
        recipientNumber: whatsappRecipient.trim(),
        sendMethod: whatsappSendMethod,
        updatedAt: new Date().toISOString()
      };

      await setDoc(doc(db, "whatsappConfigs", currentUser.uid), config);
      alert("Configuración de WhatsApp guardada correctamente.");
      setShowConfig(false);
    } catch (e) {
      console.error(e);
      alert("No se pudieron guardar los ajustes.");
    } finally {
      setConfigLoading(false);
    }
  };

  // Save Name and WhatsApp recipient from Upper form & auto-minimize
  const handleSaveTopSettings = async (e: React.FormEvent) => {
    e.preventDefault();

    // Save locally
    const savedName = userName.trim() || "";
    localStorage.setItem("tu_hijo_favorito_user_name", savedName);
    localStorage.setItem("tu_hijo_favorito_whatsapp_recipient", whatsappRecipient.trim());
    localStorage.setItem("tu_hijo_favorito_whatsapp_send_method", whatsappSendMethod);
    localStorage.setItem("tu_hijo_favorito_whatsapp_phone_id", whatsappPhoneId.trim());
    localStorage.setItem("tu_hijo_favorito_whatsapp_token", whatsappToken.trim());
    
    // Auto collapse settings
    setIsSettingsMinimized(true);
    localStorage.setItem("tu_hijo_favorito_settings_minimized", "true");

    if (currentUser) {
      setConfigLoading(true);
      try {
        const config = {
          userId: currentUser.uid,
          phoneNumberId: whatsappPhoneId.trim(),
          accessToken: whatsappToken.trim(),
          recipientNumber: whatsappRecipient.trim(),
          sendMethod: whatsappSendMethod,
          updatedAt: new Date().toISOString()
        };
        await setDoc(doc(db, "whatsappConfigs", currentUser.uid), config);
        setSuccessMemo(`💾 Configuración guardada en la nube para ${savedName || "su cuenta"} con WhatsApp ${whatsappRecipient}.`);
        setTimeout(() => setSuccessMemo(null), 4000);
      } catch (err: any) {
        console.error("Firestore settings save error:", err);
      } finally {
        setConfigLoading(false);
      }
    } else {
      setSuccessMemo("💾 Configuración guardada localmente de forma segura.");
      setTimeout(() => setSuccessMemo(null), 4000);
    }
  };

  // Send Single Note Alert to WhatsApp
  const handleSendWhatsAppNotification = async (note: Note) => {
    setIsSendingWhatsApp(note.id);
    const destPhone = whatsappRecipient.trim();

    if (!destPhone) {
      alert("Por favor configure su número de WhatsApp primero en la parte superior.");
      setIsSendingWhatsApp(null);
      return;
    }

    const priorityIcon = note.priority === "high" ? "🔴 ALTA" : note.priority === "medium" ? "🟡 MEDIA" : "🟢 BAJA";
    const messageToSend = `*⏰ RECORDATORIO ASISTENTE VIRTUAL*\n\n📌 *Tarea:* ${note.title}\n📝 *Contenido:* ${note.content || "Sin contenido adicional"}\n⚠️ *Prioridad:* ${priorityIcon}\n\n_Mensaje enviado por el Asistente Virtual._`;

    // 1. Direct Flow (Fast and Simple) or Guest Flow: Trigger direct browser Wa.me redirect link instantly
    if (whatsappSendMethod === "direct" || !currentUser) {
      try {
        const cleanRecipient = destPhone.replace(/\D/g, "");
        const waUrl = `https://wa.me/${cleanRecipient}?text=${encodeURIComponent(messageToSend)}`;
        
        // Simulating log state locally
        setSimulationLogs(prev => [{
          timestamp: new Date().toISOString(),
          sentTo: destPhone,
          message: messageToSend,
          status: "simulated_success",
        }, ...prev]);

        // Open in new tab
        window.open(waUrl, "_blank", "noopener,noreferrer");

        // Delete the note automatically once sent, as requested!
        if (currentUser) {
          try {
            await deleteDoc(doc(db, "notes", note.id));
          } catch (delErr: any) {
            console.warn("La nota ya ha sido borrada o procesada previamente:", delErr.message);
          }
        } else {
          setNotes(prev => prev.filter(n => n.id !== note.id));
        }
      } catch (e: any) {
        console.error("Direct send redirect error:", e);
      } finally {
        setIsSendingWhatsApp(null);
      }
      return;
    }

    // 2. Logged User Corporate API Flow: Server API routing + browser Web WhatsApp trigger
    try {
      const response = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumberId: whatsappPhoneId,
          accessToken: whatsappToken,
          recipientNumber: destPhone, 
          noteTitle: note.title,
          noteContent: note.content,
          notePriority: note.priority
        })
      });

      const data = await response.json();

      if (data.success) {
        // Delete from firestore automatically once sent successfully, as requested!
        if (currentUser) {
          try {
            await deleteDoc(doc(db, "notes", note.id));
          } catch (delErr: any) {
            console.warn("La nota ya ha sido borrada o procesada en el servidor:", delErr.message);
          }
        } else {
          setNotes(prev => prev.filter(n => n.id !== note.id));
        }

        if (data.log) {
          setSimulationLogs(prev => [data.log, ...prev]);
        }

        // If it's a simulated success, trigger browser redirection to actually send it!
        if (data.simulation) {
          const cleanRecipient = destPhone.replace(/\D/g, "");
          const waUrl = `https://wa.me/${cleanRecipient}?text=${encodeURIComponent(messageToSend)}`;
          
          window.open(waUrl, "_blank", "noopener,noreferrer");
        }
      } else {
        throw new Error(data.error || "Fallo el envío de WhatsApp");
      }
    } catch (error: any) {
      console.error("WhatsApp Cloud API failed, trying browser redirect fallback:", error);
      
      // Fallback: Si el endpoint de la API falla, redirigimos automáticamente a la API Web de WhatsApp (wa.me) como respaldo instantáneo.
      const cleanRecipient = destPhone.replace(/\D/g, "");
      const waUrl = `https://wa.me/${cleanRecipient}?text=${encodeURIComponent(messageToSend)}`;
      
      try {
        const win = window.open(waUrl, "_blank", "noopener,noreferrer");
        const isPopupBlocked = !win || win.closed || typeof win.closed === "undefined";

        if (!isPopupBlocked) {
          // If the redirect popup succeeded, delete the note automatically!
          if (currentUser) {
            try {
              await deleteDoc(doc(db, "notes", note.id));
            } catch (delErr: any) {
              console.warn("Fallo borrar nota en fallback (ya no existe o sin permisos):", delErr.message);
            }
          } else {
            setNotes(prev => prev.filter(n => n.id !== note.id));
          }
        } else {
          // If popup is blocked, keep it so they can try again, and save as failed status
          const fallbackNote = {
            ...note,
            whatsappStatus: "failed" as const,
            whatsappLastSent: null,
            updatedAt: new Date().toISOString()
          };
          if (currentUser) {
            try {
              await setDoc(doc(db, "notes", note.id), fallbackNote);
            } catch (fallbackErr: any) {
              console.warn("Fallo actualizar estado de nota en Firestore:", fallbackErr.message);
            }
          } else {
            setNotes(prev => prev.map(n => n.id === note.id ? fallbackNote : n));
          }
        }

        setSimulationLogs(prev => [{
          timestamp: new Date().toISOString(),
          sentTo: destPhone,
          message: `Redirigido a WhatsApp Web como respaldo (Fallo API: ${error.message || "Error token"})`,
          status: isPopupBlocked ? "failed" : "simulated_success",
          error: isPopupBlocked ? "Bloqueado por popup de navegador" : undefined
        }, ...prev]);

        if (isPopupBlocked) {
          console.warn("Popup blocked on fallback redirect");
        }
      } catch (e: any) {
        console.error("No se pudo redirigir por fallback:", e);
      }
    } finally {
      setIsSendingWhatsApp(null);
    }
  };

  // Send message immediately to WhatsApp when notes are parsed

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800 flex flex-col antialiased">
      {/* Dynamic Header */}
      <header className="bg-white border-b border-slate-150 py-1.5 px-4 flex items-center shadow-xs sticky top-0 z-30">
        {/* Name Configuration and Auth Bar */}
        <div className="flex items-center justify-between w-full gap-2">
          {/* Maximize/Minimize Toggle Button with Centered Modal */}
          <div className="inline-block text-left">
            {isSettingsMinimized ? (
              <button
                onClick={() => {
                  setIsSettingsMinimized(false);
                  localStorage.setItem("tu_hijo_favorito_settings_minimized", "false");
                }}
                className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs py-1.5 px-3 rounded-xl flex items-center space-x-1 border border-indigo-200 shadow-sm transition-all active:scale-95 cursor-pointer"
                title="Configurar teléfono y nombre"
              >
                <span>⚙️ Configurar Alertas</span>
              </button>
            ) : (
              <button
                onClick={() => {
                  setIsSettingsMinimized(true);
                  localStorage.setItem("tu_hijo_favorito_settings_minimized", "true");
                }}
                className="bg-indigo-600 text-white font-bold text-xs py-1.5 px-3 rounded-xl flex items-center space-x-1 shadow-sm transition-all active:scale-95 cursor-pointer animate-pulse"
                title="Cerrar configuración"
              >
                <span>⚙️ Ajustes Activos</span>
              </button>
            )}

            {/* CENTERED MODAL SETTINGS PANEL */}
            {!isSettingsMinimized && (
              <>
                {/* Dark backdrop overlay */}
                <div 
                  className="fixed inset-0 bg-black/75 backdrop-blur-xs z-50 transition-opacity"
                  onClick={() => {
                    setIsSettingsMinimized(true);
                    localStorage.setItem("tu_hijo_favorito_settings_minimized", "true");
                  }}
                />
                
                {/* Centered Modal content */}
                <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90%] max-w-sm bg-slate-900 border border-slate-800 text-white rounded-2xl p-6 shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-200">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
                    <span className="text-xs font-bold tracking-wider uppercase text-indigo-300">
                      ⚙️ Ajustes de Alertas
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setIsSettingsMinimized(true);
                        localStorage.setItem("tu_hijo_favorito_settings_minimized", "true");
                      }}
                      className="text-slate-400 hover:text-white text-xs bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-850 hover:border-slate-700 transition cursor-pointer"
                    >
                      ✕ Cerrar
                    </button>
                  </div>
                  <form onSubmit={handleSaveTopSettings} className="space-y-4">
                    <div>
                      <label className="text-[10px] uppercase tracking-wider font-bold text-indigo-300 block mb-1.5">
                        ¿Cómo le llamamos?:
                      </label>
                      <input
                        type="text"
                        placeholder={currentUser?.displayName ? `Ej: ${currentUser.displayName.split(" ")[0]}` : "Ej: Sr. Abraham"}
                        value={userName}
                        onChange={(e) => setUserName(e.target.value)}
                        className="w-full text-xs font-semibold bg-slate-950 border border-slate-850 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500 placeholder-slate-600 transition"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] uppercase tracking-wider font-bold text-indigo-300 block mb-1.5">
                        Teléfono WhatsApp con código:
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="Ej: +3460000500"
                        value={whatsappRecipient}
                        onChange={(e) => setWhatsappRecipient(e.target.value)}
                        className="w-full text-xs font-mono font-bold bg-slate-950 border border-slate-850 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500 placeholder-slate-600 transition"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] uppercase tracking-wider font-bold text-indigo-300 block mb-1.5">
                        Método de Envío:
                      </label>
                      <select
                        value={whatsappSendMethod}
                        onChange={(e) => setWhatsappSendMethod(e.target.value as "direct" | "api")}
                        className="w-full text-xs font-bold bg-slate-950 border border-slate-850 text-white rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition"
                      >
                        <option value="direct">⚡ Rápido (Redirección wa.me)</option>
                        <option value="api">🏢 API Cloud (Envío 100% Automático)</option>
                      </select>
                    </div>

                    {/* Explanatory text and input fields depending on chosen method */}
                    {whatsappSendMethod === "api" ? (
                      <div className="space-y-3 bg-slate-950/60 p-3 rounded-xl border border-indigo-950 animate-slide-in">
                        <p className="text-[10px] text-indigo-200 leading-relaxed">
                          💡 <strong>Envío 100% Automático:</strong> Este método permite que el Asistente envíe las alertas de forma invisible en segundo plano. Requiere que ingreses las credenciales gratuitas de Meta Business:
                        </p>
                        
                        <div>
                          <label className="text-[9px] uppercase tracking-wider font-semibold text-indigo-400 block mb-1">
                            ID de Teléfono WhatsApp (Meta):
                          </label>
                          <input
                            type="text"
                            required
                            placeholder="Ej: 1048492029310"
                            value={whatsappPhoneId}
                            onChange={(e) => setWhatsappPhoneId(e.target.value)}
                            className="w-full text-xs font-mono bg-slate-900 border border-slate-800 text-white rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          />
                        </div>

                        <div>
                          <label className="text-[9px] uppercase tracking-wider font-semibold text-indigo-400 block mb-1">
                            Token Permanente (Access Token):
                          </label>
                          <input
                            type="password"
                            required
                            placeholder="Ej: EAABwB5..."
                            value={whatsappToken}
                            onChange={(e) => setWhatsappToken(e.target.value)}
                            className="w-full text-xs font-mono bg-slate-900 border border-slate-800 text-white rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-850/30">
                        <p className="text-[10px] text-amber-200/90 leading-relaxed">
                          ⚠️ <strong>Límite del enlace rápido wa.me:</strong> Abre WhatsApp con el mensaje pre-escrito en tu chat, pero las políticas de seguridad de Facebook exigen que presiones "Enviar" manualmente. ¡Cambia a <strong>API Cloud</strong> arriba para envíos 100% automáticos!
                        </p>
                      </div>
                    )}

                    <div className="flex justify-end pt-2">
                      <button
                        type="submit"
                        className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs py-2 rounded-xl transition-all active:scale-95 shadow-md shadow-indigo-950/40 cursor-pointer"
                      >
                        Guardar Configuración
                      </button>
                    </div>
                  </form>
                </div>
              </>
            )}
          </div>

          {/* Core Auth status */}
          <div className="flex items-center space-x-2">
            {authLoading ? (
              <span className="text-xs text-slate-400">Verificando sesión...</span>
            ) : currentUser ? (
              <div className="flex items-center space-x-2 bg-slate-50 border border-slate-100 py-1.5 px-3 rounded-xl">
                {currentUser.photoURL ? (
                  <img
                    src={currentUser.photoURL}
                    referrerPolicy="no-referrer"
                    alt="Avatar"
                    className="w-5.5 h-5.5 rounded-full border border-indigo-400"
                  />
                ) : (
                  <div className="w-5.5 h-5.5 bg-indigo-100 text-indigo-700 font-bold rounded-full flex items-center justify-center text-xs">
                    {currentUser.displayName ? currentUser.displayName[0] : "P"}
                  </div>
                )}
                <span className="text-xs font-semibold text-slate-700 max-w-[100px] truncate">
                  {currentUser.displayName || currentUser.email}
                </span>
                <button
                  onClick={handleLogout}
                  className="text-slate-400 hover:text-red-500 p-0.5 transition-colors"
                  title="Cerrar sesión"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={handleGoogleLogin}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs py-2 px-3.5 rounded-xl flex items-center space-x-1.5 shadow-md transition-all active:scale-95"
              >
                <span>Acceder con Google</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Instant schedule success notification bar */}
      {successMemo && (
        <div className="bg-emerald-500 text-white text-xs font-bold py-2.5 px-4 text-center sticky top-[48px] z-20 shadow-md flex items-center justify-center space-x-2 animate-bounce">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successMemo}</span>
        </div>
      )}

      {/* Main Container Workspace */}
      <main className="flex-1 w-full max-w-2xl mx-auto p-4 md:p-6 flex flex-col gap-6 z-10">

        {/* Dynamic centered Chat Assistant */}
        <div className="flex flex-col space-y-4">
          <AssistantChat 
            notes={notes} 
            userName={userName} 
            onSuggestedNote={handleSuggestedNoteImport} 
          />
        </div>

        {/* Collapsible WhatsApp & Simulator Credentials Section */}
        <section className="bg-white rounded-2xl border border-slate-150 p-5 shadow-xs">
          <button
            onClick={() => setShowConfig(!showConfig)}
            className="w-full flex items-center justify-between text-left text-xs font-bold text-slate-800 focus:outline-none cursor-pointer"
          >
            <span className="flex items-center space-x-2">
              <Settings className="w-4.5 h-4.5 text-slate-400" />
              <span>⚙️ Configurar alertas por WhatsApp</span>
            </span>
            <span className="text-[10px] text-indigo-600 uppercase bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-full font-bold">
              {showConfig ? "Ocultar" : "Mostrar"}
            </span>
          </button>

          {showConfig && (
            <form onSubmit={handleSaveWhatsAppConfig} className="space-y-4 mt-4 pt-4 border-t border-slate-100 animate-slide-in">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">
                  ID de Teléfono WhatsApp Corporativo:
                </label>
                <input
                  type="text"
                  required
                  placeholder="P.ej: 1048492029310"
                  value={whatsappPhoneId}
                  onChange={(e) => setWhatsappPhoneId(e.target.value)}
                  className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-2.5 bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">
                  Token Permanente Graph API (Access Token):
                </label>
                <input
                  type="password"
                  required
                  placeholder="EAABwB5... (Token Secreto)"
                  value={whatsappToken}
                  onChange={(e) => setWhatsappToken(e.target.value)}
                  className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-2.5 bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">
                  Tu número WhatsApp destinatario:
                </label>
                <input
                  type="text"
                  required
                  placeholder="P.ej: +34600000000 o +5215500"
                  value={whatsappRecipient}
                  onChange={(e) => setWhatsappRecipient(e.target.value)}
                  className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-2.5 bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 font-bold"
                />
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="submit"
                  disabled={configLoading || !currentUser}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs py-2 px-4 rounded-xl shadow-md cursor-pointer transition-all active:scale-95"
                >
                  Guardar Credenciales
                </button>
              </div>
            </form>
          )}

          {/* Simulated instant logs console */}
          <div className="mt-4 pt-3.5 border-t border-slate-150">
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block mb-1.5 font-mono">
              🖨️ Consola del Simulador de Notificaciones (Feedback local)
            </span>
            <div className="bg-slate-900 rounded-xl p-3 text-[10px] font-mono text-emerald-400 border border-slate-800 space-y-1 max-h-[110px] overflow-y-auto w-full">
              {simulationLogs.length === 0 ? (
                <p className="text-slate-500 italic font-mono">No hay alertas enviadas en esta sesión. Chatea con tu hijo favorito y presiona "Enviar" para abrir o despachar.</p>
              ) : (
                simulationLogs.map((log, idx) => (
                  <div key={idx} className="border-b border-slate-800/60 pb-1 last:border-0 last:pb-0 font-mono">
                    <span className="text-slate-500 font-mono">[{new Date(log.timestamp).toLocaleTimeString()}]</span>{" "}
                    {log.status === "simulated_success" ? (
                      <span className="text-amber-400 font-bold font-mono">[Simulado OK]</span>
                    ) : log.status === "real_success" ? (
                      <span className="text-emerald-400 font-bold font-mono">[ENVIADO REAL]</span>
                    ) : (
                      <span className="text-rose-550 font-bold font-mono">[FALLO]</span>
                    )}{" "}
                    Enviado a <span className="text-indigo-200 font-mono">{log.sentTo}</span>:{" "}
                    <span className="text-slate-300 italic font-mono">{log.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

      </main>

    {/* Modal de Alerta Activa para WhatsApp Directo (Bypasses popup blocker seamlessly) */}
    {activeDueNote && (
      <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-slate-900 border border-slate-800 text-white rounded-2xl w-full max-w-md p-6 shadow-2xl relative animate-slide-in">
          <button
            onClick={() => setActiveDueNote(null)}
            className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors"
          >
            ✕
          </button>

          <div className="flex items-center space-x-3 mb-4">
            <div className="w-10 h-10 bg-amber-500/20 text-amber-400 rounded-full flex items-center justify-center text-lg animate-pulse shrink-0">
              ⏰
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-100">¡Alerta Activa Programada!</h3>
              <p className="text-xs text-indigo-300">Llegó el momento de enviar el recordatorio</p>
            </div>
          </div>

          <div className="bg-slate-950/65 border border-slate-850 rounded-xl p-4 mb-5">
            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">📌 Tarea:</h4>
            <p className="text-sm font-semibold text-white mt-1">{activeDueNote.title}</p>
            
            {activeDueNote.content && (
              <div className="mt-2 text-xxs text-slate-400 border-t border-slate-850/60 pt-2">
                <h5 className="font-bold text-[10px] text-slate-400 uppercase tracking-wider">Detalles:</h5>
                <p className="italic mt-0.5 whitespace-pre-line text-xs text-slate-300">{activeDueNote.content}</p>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <button
              onClick={() => {
                handleSendWhatsAppNotification(activeDueNote);
                setActiveDueNote(null);
              }}
              className="w-full bg-gradient-to-r from-emerald-500 to-teal-500 hover:scale-101 active:scale-97 text-white text-xs font-bold py-3 rounded-xl shadow-lg transition-transform flex items-center justify-center space-x-2 animate-bounce cursor-pointer"
            >
              <span>🚀 ENVIAR AHORA POR WHATSAPP</span>
            </button>
            <button
              onClick={() => setActiveDueNote(null)}
              className="w-full bg-slate-800 hover:bg-slate-750 text-slate-300 text-xs font-semibold py-2.5 rounded-xl transition-colors cursor-pointer"
            >
              Ignorar por ahora
            </button>
          </div>
        </div>
      </div>
    )}

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200/60 py-5 mt-10 text-center text-xs text-slate-400">
        <p>Asistente Virtual de Recordatorios y Productividad.</p>
        <p className="mt-1 text-[11px] text-slate-300">Con el soporte técnico de Firestore e Inteligencia Artificial.</p>
      </footer>
    </div>
  );
}
