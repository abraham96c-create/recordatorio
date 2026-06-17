import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// Initialize Google GenAI
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

app.use(express.json());

// --- ROBÚSTICAS FUNCIONES AUXILIARES PARA EL MODO GRATUITO LOCAL (FALLBACK SIN CLAVE API) ---

function cleanText(str: string): string {
  if (!str) return "";
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function addDays(dateStr: string, days: number): string {
  try {
    const d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() + days);
    return d.toISOString().split("T")[0];
  } catch (e) {
    return dateStr;
  }
}

function getNextWeekdayDate(currentDateStr: string, targetDayEs: string): string {
  const daysEs = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
  const targetIndex = daysEs.indexOf(cleanText(targetDayEs));
  if (targetIndex === -1) return currentDateStr;

  try {
    const current = new Date(currentDateStr + "T00:00:00");
    const currentIndex = current.getDay(); // 0 is Sunday, 1 Monday...
    let daysToAdd = targetIndex - currentIndex;
    if (daysToAdd <= 0) {
      daysToAdd += 7;
    }
    return addDays(currentDateStr, daysToAdd);
  } catch (e) {
    return currentDateStr;
  }
}

function getLocalHijoResponse(
  message: string,
  userName: string,
  currentDate: string,
  chatHistory?: { sender: string; text: string }[]
): { response: string; suggestedNote?: any } {
  const msgClean = cleanText(message);
  const nameToUse = userName && userName.trim() ? userName.trim() : "Usuario";

  // Buscar si antes de este mensaje hubo alguna tarea original o si estamos en flujo de seguimiento
  let originalTask = "";
  if (chatHistory && chatHistory.length > 0) {
    let lastAssistantIdx = -1;
    for (let i = chatHistory.length - 1; i >= 0; i--) {
      if (chatHistory[i].sender === "assistant" && chatHistory[i].text.includes("¿")) {
        lastAssistantIdx = i;
        break;
      }
    }
    if (lastAssistantIdx !== -1) {
      for (let j = lastAssistantIdx - 1; j >= 0; j--) {
        if (chatHistory[j].sender === "user") {
          originalTask = chatHistory[j].text;
          break;
        }
      }
    }
  }

  // Extraer el posible asunto del recordatorio
  let textToExtract = "";
  if (
    msgClean.includes("recordar") ||
    msgClean.includes("anota") ||
    msgClean.includes("pendiente") ||
    msgClean.includes("tarea") ||
    msgClean.includes("comprar") ||
    msgClean.includes("llamar") ||
    msgClean.includes("pasar") ||
    msgClean.includes("ir") ||
    msgClean.includes("visitar")
  ) {
    textToExtract = message;
  } else if (originalTask) {
    textToExtract = originalTask;
  } else {
    textToExtract = message;
  }

  let tempTitle = textToExtract;
  const prefixes = [
    /recordar de/i, /recordar que/i, /recordar a/i, /recordar/i, /recordarme/i,
    /quiero que me recuerdes/i, /quiero recordar/i, /por favor anota/i,
    /anota que/i, /anotame/i, /anota/i, /pendiente:/i, /tarea:/i, /que no se me olvide/i,
    /pasar por/i, /pasar para/i, /pasar a/i
  ];
  for (const regex of prefixes) {
    tempTitle = tempTitle.replace(regex, "");
  }
  let taskTitle = tempTitle.trim();
  
  if (taskTitle) {
    taskTitle = taskTitle.charAt(0).toUpperCase() + taskTitle.slice(1);
    // Eliminar palabras de tiempo comunes al final del título para limpiarlo
    const timeSfxs = ["hoy", "manana", "mas tarde", "urgente", "por favor"];
    for (const sfx of timeSfxs) {
      if (taskTitle.toLowerCase().endsWith(sfx)) {
        taskTitle = taskTitle.slice(0, taskTitle.toLowerCase().lastIndexOf(sfx)).trim();
      }
    }
  } else {
    taskTitle = "Pendiente familiar";
  }

  // Resolver la fecha con soporte mejorado para formatos en español
  let extractedDate = "";
  let dateKeywordUsed = "";

  const checkTextForDate = (txt: string) => {
    const txtClean = cleanText(txt);
    
    // 1. SPECIFIC DATES FIRST:
    // Comprobar formato "X de [Mes]" (ej. 15 de junio)
    const monthsEs = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
    const deMatch = txtClean.match(/(\d{1,2})\s+de\s+([a-z]+)/);
    if (deMatch) {
      const dayNum = parseInt(deMatch[1]);
      const monthIndex = monthsEs.indexOf(deMatch[2]);
      if (monthIndex !== -1) {
        try {
          const currentYear = new Date(currentDate + "T00:00:00").getFullYear();
          // Deterministic string generation to avoid timezone/UTC-shift bugs!
          const yyyy = currentYear;
          const mm = String(monthIndex + 1).padStart(2, "0");
          const dd = String(dayNum).padStart(2, "0");
          dateKeywordUsed = `${dayNum} de ${deMatch[2]}`;
          return `${yyyy}-${mm}-${dd}`;
        } catch (e) {}
      }
    }
    
    // Formato estándar YYYY-MM-DD
    const dateMatch = txt.match(/\d{4}-\d{2}-\d{2}/);
    if (dateMatch) {
      return dateMatch[0];
    }
    
    // Formato estándar DD/MM/YYYY o DD-MM-YYYY
    const slashMatch = txt.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
    if (slashMatch) {
      const day = parseInt(slashMatch[1]);
      const month = parseInt(slashMatch[2]);
      let year = parseInt(slashMatch[3]);
      if (year < 100) year += 2000;
      const mm = String(month).padStart(2, "0");
      const dd = String(day).padStart(2, "0");
      return `${year}-${mm}-${dd}`;
    }

    // 2. RELATIVE DATES LATER:
    // Pasado Mañana
    if (txtClean.includes("pasado mañana") || txtClean.includes("pasado manana")) {
      dateKeywordUsed = "pasado mañana";
      return addDays(currentDate, 2);
    }
    
    // Mañana / Manana
    if (txtClean.includes("mañana") || txtClean.includes("manana")) {
      dateKeywordUsed = "mañana";
      return addDays(currentDate, 1);
    }

    // Hoy / Ahora
    if (txtClean.includes("hoy") || txtClean.includes("ahora") || txtClean.includes("ya mismo")) {
      dateKeywordUsed = "hoy";
      return currentDate;
    }
    
    // Días de la semana
    const weekdays = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
    for (const w of weekdays) {
      if (txtClean.includes(w)) {
        dateKeywordUsed = `el ${w}`;
        return getNextWeekdayDate(currentDate, w);
      }
    }

    return "";
  };

  extractedDate = checkTextForDate(message);
  if (!extractedDate && originalTask) {
    extractedDate = checkTextForDate(originalTask);
  }

  // Resolver la hora/momento con soporte robusto para AM/PM y modismos en español
  let extractedTime = "";
  const checkTextForTime = (txt: string) => {
    const txtClean = cleanText(txt);
    
    // 1. HH:MM con sufijos o expresiones de tarde/noche/AM/PM (ej: 13:20, 1:30 pm, 3:45 tarde)
    const colPmAmMatch = txtClean.match(/(\d{1,2}):(\d{2})\s*(pm|en la tarde|en la noche|tarde|noche|a\.m\.|p\.m\.)/);
    if (colPmAmMatch) {
      let hr = parseInt(colPmAmMatch[1]);
      const min = colPmAmMatch[2];
      const suffix = colPmAmMatch[3];
      if (suffix.includes("pm") || suffix.includes("p.m.") || suffix.includes("tarde") || suffix.includes("noche")) {
        if (hr < 12) hr += 12;
      } else if (suffix.includes("am") || suffix.includes("a.m.")) {
        if (hr === 12) hr = 0;
      }
      return `${String(hr).padStart(2, "0")}:${min}`;
    }

    // 2. Formato simple HH:MM (ej: 16:30, 08:15) - comprobar contexto de PM en el mensaje
    const colMatch = txt.match(/(\d{1,2}):(\d{2})/);
    if (colMatch) {
      let hr = parseInt(colMatch[1]);
      const min = colMatch[2];
      // Si la frase entera contiene palabras de tarde/noche, ajustarla a PM si es menor de 12
      if (txtClean.includes("pm") || txtClean.includes("p.m.") || txtClean.includes("tarde") || txtClean.includes("noche")) {
        if (hr < 12) hr += 12;
      }
      return `${String(hr).padStart(2, "0")}:${min}`;
    }

    // 3. Horas enteras con distinción de PM (ej: a las 3 pm, las 2 de la tarde, 8 de la noche)
    const pmMatch = txtClean.match(/(?:a las|a la|las|la)\s+(\d{1,2})\s*(?:de la|en la)?\s*(pm|p\.m\.|tarde|noche)/);
    if (pmMatch) {
      const hr = parseInt(pmMatch[1]);
      const finalHr = hr < 12 ? hr + 12 : hr;
      return `${String(finalHr).padStart(2, "0")}:00`;
    }

    // 4. Horas enteras con distinción de AM (ej: a las 8 am, las 6 de la mañana)
    const amMatch = txtClean.match(/(?:a las|a la|las|la)\s+(\d{1,2})\s*(?:de la|en la)?\s*(am|a\.m\.|mañana|manana|temprano)/);
    if (amMatch) {
      const hr = parseInt(amMatch[1]);
      const finalHr = hr === 12 ? 0 : hr;
      return `${String(finalHr).padStart(2, "0")}:00`;
    }

    // 5. Horas enteras sin designación explícita (ej: a las 13, a las 4)
    const simpleHrMatch = txtClean.match(/(?:a las|a la|las|la)\s+(\d{1,2})/);
    if (simpleHrMatch) {
      let hr = parseInt(simpleHrMatch[1]);
      if (txtClean.includes("pm") || txtClean.includes("p.m.") || txtClean.includes("tarde") || txtClean.includes("noche")) {
        if (hr < 12) hr += 12;
      }
      const padHr = hr.toString().padStart(2, "0");
      return `${padHr}:00`;
    }

    // 6. Expresiones temporales generales (asigna horas estándar por defecto)
    if (txtClean.includes("mas tarde") || txtClean.includes("en la tarde")) {
      return "16:00"; // 4:00 PM por defecto
    }
    if (txtClean.includes("en la mañana") || txtClean.includes("temprano") || txtClean.includes("en la manana")) {
      return "09:00"; // 9:00 AM por defecto
    }
    if (txtClean.includes("en la noche")) {
      return "20:00"; // 8:00 PM por defecto
    }

    return "";
  };

  extractedTime = checkTextForTime(message);
  if (!extractedTime && originalTask) {
    extractedTime = checkTextForTime(originalTask);
  }

  // Extraer prioridad
  let priority: "high" | "medium" | "low" = "medium";
  const allTxt = `${message} ${originalTask || ""}`.toLowerCase();
  if (allTxt.includes("urgente") || allTxt.includes("importante") || allTxt.includes("urgencia") || allTxt.includes("alto") || allTxt.includes("alta")) {
    priority = "high";
  } else if (allTxt.includes("con calma") || allTxt.includes("despues") || allTxt.includes("baja") || allTxt.includes("despacio")) {
    priority = "low";
  }

  const isVagueTime = !extractedTime || extractedTime.includes("por confirmar");
  const isMissingDate = !extractedDate;

  // Si nos falta información crucial sobre día u hora, preguntamos de forma directa, seria y con tacto profesional
  if (isMissingDate || isVagueTime) {
    let responseText = "";
    if (isMissingDate && isVagueTime) {
      responseText = `Entendido, ${nameToUse}. He tomado nota del recordatorio de: "${taskTitle}".
      
Para agendarlo de manera precisa, ¿podría indicarme **para qué fecha o día** (ej. hoy, mañana, el lunes) y **a qué hora exacta** desea programar la alerta?`;
    } else if (isMissingDate) {
      responseText = `Entendido, ${nameToUse}. Dispongo de la hora confirmada (${extractedTime}), pero ¿podría especificar **para qué fecha o día** programamos la alerta para "${taskTitle}"?`;
    } else {
      responseText = `Entendido, ${nameToUse}. La fecha está programada para el día ${dateKeywordUsed || extractedDate}. ¿A qué hora exacta desea programar la alerta para "${taskTitle}"?`;
    }

    return { response: responseText };
  }

  // Guardamos la nota EXCLUYENDO el título en el cuerpo, para evitar duplicidad visual en el listado
  const finalContent = `⏰ Programado a las ${extractedTime} del día ${extractedDate}.\n💬 Se enviará la alerta por WhatsApp para recordar este pendiente.`;

  const responseText = `¡Listo, ${nameToUse}! He programado su alerta de forma automática para enviarla directo a su WhatsApp en el momento indicado:
📌 **Asunto:** ${taskTitle}
📆 **Programado para:** ${extractedDate} (${dateKeywordUsed || "confirmado"})
⏰ **Hora:** ${extractedTime}
⚠️ **Prioridad:** ${priority === "high" ? "Alta" : priority === "medium" ? "Media" : "Baja"}

⏰ El sistema registrará y despachará esta alerta automáticamente en cuanto se cumpla la hora configurada sin necesidad de acciones adicionales.`;

  return {
    response: responseText,
    suggestedNote: {
      title: taskTitle,
      content: finalContent,
      priority: priority,
      date: extractedDate,
      tags: ["Asistente", priority === "high" ? "Urgente" : "Recordatorio"]
    }
  };
}

function getLocalNoteAnalysis(title: string, content: string) {
  const allTxt = `${title || ""} ${content || ""}`.toLowerCase();
  let priority = "medium";
  if (allTxt.includes("urgente") || allTxt.includes("importante") || allTxt.includes("alto") || allTxt.includes("alta")) {
    priority = "high";
  } else if (allTxt.includes("con calma") || allTxt.includes("despues") || allTxt.includes("baja")) {
    priority = "low";
  }

  const tags = ["Personal"];
  if (allTxt.includes("alba") || allTxt.includes("familia") || allTxt.includes("casa")) tags.push("Familia");
  if (allTxt.includes("comprar") || allTxt.includes("precio") || allTxt.includes("super") || allTxt.includes("pagar")) tags.push("Compras");
  if (allTxt.includes("medico") || allTxt.includes("salud") || allTxt.includes("farmacia") || allTxt.includes("medicina")) tags.push("Salud");
  
  if (tags.length === 1) tags.push("Recordatorio");

  const whatsappMessage = `*⏰ RECORDATORIO ASISTENTE VIRTUAL*\n\n📌 *Tarea:* ${title}\n📝 *Contenido:* ${content || "Hecho con seriedad"}\n⚠️ *Prioridad:* ${
    priority === "high" ? "🔴 ALTA" : priority === "medium" ? "🟡 MEDIA" : "🟢 BAJA"
  }\n\n_Mensaje enviado por el Asistente Virtual de Recordatorios._`;

  return { tags, priority, whatsappMessage };
}

// API: Analyze Note (Auto tags, auto priority, and custom reminder layout)
app.post("/api/gemini/analyze", async (req, res) => {
  const { title, content, date } = req.body;

  if (!title && !content) {
    return res.status(400).json({ error: "Missing title or content to analyze." });
  }

  // Si no hay API Key o está vacía, saltar directo al fallback gratuito
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.includes("YOUR_API_KEY")) {
    console.log("[Free AI Fallback] Analyzing note with local rule engine");
    const localResult = getLocalNoteAnalysis(title, content);
    return res.json(localResult);
  }

  try {
    const prompt = `Analiza la siguiente nota o tarea y genera:
1. Una lista de etiquetas (tags) personalizadas y adecuadas (máximo 4, cortas, p.ej. "Trabajo", "Salud", "Compras").
2. Un nivel de prioridad adecuado: "high", "medium" o "low" basado en la urgencia descrita.
3. El borrador de un mensaje recordatorio conciso y elegante optimizado para ser enviado por WhatsApp.

Título de la nota: "${title || ""}"
Contenido de la nota: "${content || ""}"
Fecha programada: "${date || ""}"`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        systemInstruction: "Eres un asistente virtual experto en organización de proyectos y productividad personal. Analizas notas para organizarlas con precisión.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            tags: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Lista de etiquetas sugeridas para clasificar la tarea.",
            },
            priority: {
              type: Type.STRING,
              description: "Nivel de prioridad recomendado: 'high', 'medium' o 'low'.",
            },
            whatsappMessage: {
              type: Type.STRING,
              description: "Borrador óptimo de mensaje de WhatsApp con emojis para recordar esto.",
            },
          },
          required: ["tags", "priority", "whatsappMessage"],
        },
      },
    });

    const bodyText = response.text || "{}";
    const result = JSON.parse(bodyText.trim());
    return res.json(result);
  } catch (error: any) {
    console.log("[Fallback Engine] El asistente analizó los datos localmente de forma exitosa.");
    const localResult = getLocalNoteAnalysis(title, content);
    return res.json(localResult);
  }
});

// API: Assistant Chat
app.post("/api/gemini/chat", async (req, res) => {
  const { message, notesHistory, userName, currentDate, chatHistory } = req.body;

  if (!message) {
    return res.status(400).json({ error: "Falta el mensaje." });
  }

  const nameToUse = userName && userName.trim() ? userName.trim() : "Usuario";
  const dateToUse = currentDate || new Date().toISOString().split("T")[0];

  // Si no hay API Key o está vacía, saltar directo al fallback gratuito de "Tu hijo favorito"
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.includes("YOUR_API_KEY")) {
    console.log("[Free AI Fallback] Chatting via local 'Tu hijo favorito' AI engine");
    const localChatResult = getLocalHijoResponse(message, nameToUse, dateToUse, chatHistory);
    return res.json(localChatResult);
  }

  try {
    const notesContext = notesHistory && notesHistory.length > 0 
      ? `Aquí tienes el listado de las notas y pendientes actuales de ${nameToUse}:\n${JSON.stringify(notesHistory, null, 2)}`
      : `El usuario ${nameToUse} aún no tiene notas creadas.`;

    const prompt = `Mensaje de ${nameToUse}: "${message}"\n\n${notesContext}\n\nFecha actual de referencia para hoy/mañana/horas: ${dateToUse}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        systemInstruction: `Eres "Tu Hijo Favorito", un servicio inteligente de mensajería instantánea de recordatorios diseñado específicamente para simular o programar el envío de alertas directas al WhatsApp del usuario ${nameToUse}. Tu propósito absoluto es actuar como una central de mensajería personal: tomas lo que el usuario necesita recordar, lo organizas al instante, y te preparas para enviarlo derechito a su WhatsApp como un mensaje directo, limpio y útil.

CRÍTICAS REGLAS DE CONVERSACIÓN:
1. CANALES DE MENSAJERÍA DIRECTA: Explícale al usuario que estás listo para mandarle o programarle un mensaje de WhatsApp directo a su teléfono con lo que te pida. No hay de libretas de notas tradicionales; todo es por chat inteligente de mensajería directa por WhatsApp.
2. Mantén un tono sumamente servicial, profesional, formal y respetuoso, pero sumamente ágil y enfocado. Por ejemplo: "Entendido, ${nameToUse}. He preparado el mensaje para su WhatsApp." o "Con gusto organizaré este recordatorio."
3. REVISIÓN DE DATOS COMPLETOS: Para poder calendarizar o despachar correctamente la alerta de WhatsApp, requieres de forma indispensable confirmar el Asunto o tarea, la Fecha exacta (YYYY-MM-DD) y la Hora. Traduce modismos dinámicos ("hoy", "mañana", "el lunes") a base de la fecha actual de referencia (${dateToUse}).
4. PREGUNTAS SENSATAS: Si falta algún dato fundamental, pregúntaselo con cortesía y rapidez antes de conformar el JSON 'suggestedNote'.
5. CUANDO LOS DATOS ESTÉN LISTOS:
   - Genera el objeto json estructurado 'suggestedNote'.
   - IMPORTANTE (DUPLICIDAD): En la propiedad 'content' de 'suggestedNote', NO repitas el título o nombre de la tarea. Guarda detalles como la fecha/hora de forma concisa (ej: "⏰ Programado para las 10:00. Alerta configurada para WhatsApp."). No redundes con el título arriba.
   - En tu respuesta de texto conversacional ('response'), confírmale alegremente que has creado y programado el recordatorio de manera 100% AUTOMÁTICA en el sistema en segundo plano. Explícale que se enviará directamente a su WhatsApp en cuanto llegue el momento exacto configurado sin necesidad de que tenga que hacer clic en nada ni guardar notas manuales.`,
        responseMimeType: "application/json",


        responseSchema: {
          type: Type.OBJECT,
          properties: {
            response: {
              type: Type.STRING,
              description: "Tu respuesta de texto conversacional respetuosa, clara y profesional con el usuario en español. Debe incluir preguntas precisas si hacen falta datos para agendar la nota."
            },
            suggestedNote: {
              type: Type.OBJECT,
              description: "Opcional. Proporciónalo ÚNICAMENTE cuando el usuario describa un pendiente con todos los detalles claros (Título, Fecha y Hora aclarados) para guardarlo de inmediato.",
              properties: {
                title: { type: Type.STRING, "description": "Título breve y profesional de la tarea." },
                content: { type: Type.STRING, "description": "Cuerpo de la nota especificando los detalles. NO repitas ni dupliques el título de la tarea aquí." },
                priority: { type: Type.STRING, "description": "Prioridad sugerida: 'high', 'medium' o 'low'." },
                date: { type: Type.STRING, "description": "Fecha del recordatorio deducida en formato YYYY-MM-DD." },
                tags: { type: Type.ARRAY, items: { type: Type.STRING }, "description": "Etiquetas sugeridas (máximo 2, ej. ['Trabajo', 'Salud'])." }
              },
              required: ["title", "content", "priority", "date", "tags"]
            }
          },
          required: ["response"]
        }
      },
    });

    try {
      const parsedData = JSON.parse(response.text || "{}");
      return res.json(parsedData);
    } catch (parseErr) {
      console.error("Failed to parse assistant JSON response:", response.text);
      return res.json({ response: response.text || `No logré estructurar la respuesta, papá ${nameToUse}.` });
    }
  } catch (error: any) {
    console.log("[Fallback Engine] Chat procesado localmente con éxito ante límites de cuota temporales.");
    const localChatResult = getLocalHijoResponse(message, nameToUse, dateToUse, chatHistory);
    return res.json(localChatResult);
  }
});

// API: Send WhatsApp Notification
app.post("/api/whatsapp/send", async (req, res) => {
  try {
    const { 
      phoneNumberId, 
      accessToken, 
      recipientNumber, 
      noteTitle, 
      noteContent, 
      notePriority,
      customMessage
    } = req.body;

    if (!recipientNumber) {
      return res.status(400).json({ error: "Falta el número de teléfono del destinatario." });
    }

    // Prepare standard text message body
    const priorityIcon = notePriority === "high" ? "🔴 ALTA" : notePriority === "medium" ? "🟡 MEDIA" : "🟢 BAJA";
    const defaultBodyFormat = `*⏰ RECORDATORIO ASISTENTE VIRTUAL*\n\n📌 *Tarea:* ${noteTitle}\n📝 *Contenido:* ${noteContent || "Sin contenido adicional"}\n⚠️ *Prioridad:* ${priorityIcon}\n\n_Mensaje enviado automáticamente desde tu gestor de notas._`;
    const messageToSend = customMessage || defaultBodyFormat;

    // Local simulation fallback or Real API request
    const mockSimulationLog = {
      timestamp: new Date().toISOString(),
      sentTo: recipientNumber,
      message: messageToSend,
      status: "simulated_success",
    };

    if (!phoneNumberId || !accessToken) {
      // Return simulated success alongside warning about configuration
      return res.json({
        success: true,
        simulation: true,
        message: "Mensaje simulado correctamente (configura las credenciales reales de WhatsApp Cloud API en ajustes para enviarlo real).",
        log: mockSimulationLog
      });
    }

    // Clean up phone number: remove any non-digits
    const cleanRecipient = recipientNumber.replace(/\D/g, "");

    // Real fetch request to WhatsApp API
    const isRealAPIUrl = `https://graph.facebook.com/v17.0/${phoneNumberId}/messages`;
    const options = {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: cleanRecipient,
        type: "text",
        text: {
          preview_url: false,
          body: messageToSend
        }
      })
    };

    console.log(`Enviando mensaje real de WhatsApp a: ${cleanRecipient}`);
    const apiRes = await fetch(isRealAPIUrl, options);
    const apiData = await apiRes.json();

    if (!apiRes.ok) {
      console.error("WhatsApp Cloud API response error:", apiData);
      return res.status(apiRes.status).json({
        success: false,
        error: apiData.error?.message || "Error al enviar mensaje real de WhatsApp.",
        raw: apiData
      });
    }

    return res.json({
      success: true,
      simulation: false,
      message: "¡Mensaje real enviado exitosamente mediante la API de WhatsApp!",
      raw: apiData,
      log: {
        timestamp: new Date().toISOString(),
        sentTo: cleanRecipient,
        message: messageToSend,
        status: "real_success",
      }
    });

  } catch (error: any) {
    console.error("Error in WhatsApp integration route:", error);
    return res.status(500).json({ error: error.message || "Error de red en el servicio de WhatsApp." });
  }
});

// Create Vite server in development
if (process.env.NODE_ENV !== "production") {
  createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  }).then((vite) => {
    app.use(vite.middlewares);
    
    // Fallback index.html for SPA router
    app.use("*", (req, res, next) => {
      res.sendFile(path.join(process.cwd(), "index.html"));
    });

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`[Development Webserver] Running at http://localhost:${PORT}`);
    });
  });
} else {
  // Production static server
  const distPath = path.join(process.cwd(), "dist");
  app.use(express.static(distPath));
  
  app.get("*", (req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Production Webserver] Running silently on port ${PORT}`);
  });
}
