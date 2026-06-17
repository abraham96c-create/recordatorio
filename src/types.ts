export interface Note {
  id: string;
  userId: string;
  title: string;
  content: string;
  priority: "low" | "medium" | "high";
  date: string; // YYYY-MM-DD
  tags: string[];
  whatsappStatus: "pending" | "synced" | "failed";
  whatsappLastSent: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WhatsAppConfig {
  userId: string;
  phoneNumberId: string;
  accessToken: string;
  recipientNumber: string;
  updatedAt: string;
}

export interface SimulationLog {
  timestamp: string;
  sentTo: string;
  message: string;
  status: "simulated_success" | "real_success" | "failed";
  error?: string;
}
