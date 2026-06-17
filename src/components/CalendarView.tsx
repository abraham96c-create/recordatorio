import React, { useState } from "react";
import { Note } from "../types";
import { ChevronLeft, ChevronRight, Calendar, AlertCircle } from "lucide-react";

interface CalendarViewProps {
  notes: Note[];
  selectedDate: string; // YYYY-MM-DD
  onSelectDate: (date: string) => void;
}

export default function CalendarView({ notes, selectedDate, onSelectDate }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState<Date>(new Date());

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  // Helper inside display list months in Spanish
  const monthsSpanish = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
  ];

  const getDaysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
  const getFirstDayOfMonth = (y: number, m: number) => {
    // Correct offset so index 0 = Monday, ..., 6 = Sunday
    const day = new Date(y, m, 1).getDay();
    return day === 0 ? 6 : day - 1;
  };

  const daysInMonth = getDaysInMonth(year, month);
  const firstDayIndex = getFirstDayOfMonth(year, month);

  const prevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const daysToRender = [];
  // Empty slots for previous month padding
  for (let i = 0; i < firstDayIndex; i++) {
    daysToRender.push(null);
  }
  // Days of the month
  for (let d = 1; d <= daysInMonth; d++) {
    daysToRender.push(d);
  }

  const handleDayClick = (day: number) => {
    const formattedMonth = String(month + 1).padStart(2, "0");
    const formattedDay = String(day).padStart(2, "0");
    onSelectDate(`${year}-${formattedMonth}-${formattedDay}`);
  };

  const isSelected = (day: number) => {
    const formattedMonth = String(month + 1).padStart(2, "0");
    const formattedDay = String(day).padStart(2, "0");
    return selectedDate === `${year}-${formattedMonth}-${formattedDay}`;
  };

  const isToday = (day: number) => {
    const today = new Date();
    return today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
  };

  // Get notes filtered by day
  const getNotesForDay = (day: number) => {
    const formattedMonth = String(month + 1).padStart(2, "0");
    const formattedDay = String(day).padStart(2, "0");
    const dateStr = `${year}-${formattedMonth}-${formattedDay}`;
    return notes.filter(note => note.date === dateStr);
  };

  return (
    <div id="calendar-card" className="bg-white rounded-xl border border-slate-100 p-6 shadow-sm">
      <div className="flex items-center justify-between pb-4 border-b border-slate-50 mb-4">
        <div className="flex items-center space-x-2">
          <Calendar className="w-5 h-5 text-slate-500" />
          <h3 className="font-semibold text-slate-800 text-lg">
            {monthsSpanish[month]} {year}
          </h3>
        </div>
        <div className="flex space-x-1">
          <button
            onClick={prevMonth}
            className="p-1.5 hover:bg-slate-50 rounded-lg text-slate-500 transition-colors"
            title="Mes anterior"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            onClick={nextMonth}
            className="p-1.5 hover:bg-slate-50 rounded-lg text-slate-500 transition-colors"
            title="Mes siguiente"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-slate-400 mb-2">
        <div>LU</div>
        <div>MA</div>
        <div>MI</div>
        <div>JU</div>
        <div>VI</div>
        <div>SÁ</div>
        <div>DO</div>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {daysToRender.map((day, idx) => {
          if (day === null) {
            return <div key={`empty-${idx}`} className="h-10 sm:h-12" />;
          }

          const dayNotes = getNotesForDay(day);
          const hasHigh = dayNotes.some(n => n.priority === "high");
          const hasMedium = dayNotes.some(n => n.priority === "medium");
          const hasLow = dayNotes.some(n => n.priority === "low");

          const selected = isSelected(day);
          const today = isToday(day);

          return (
            <button
              key={`day-${day}`}
              onClick={() => handleDayClick(day)}
              className={`h-10 sm:h-12 relative flex flex-col items-center justify-between py-1.5 rounded-lg border transition-all ${
                selected
                  ? "bg-indigo-600 border-indigo-600 text-white shadow-sm shadow-indigo-100"
                  : today
                  ? "bg-indigo-50 border-indigo-200 text-indigo-700 font-semibold"
                  : "bg-white border-transparent hover:bg-slate-50 text-slate-700"
              }`}
            >
              <span className="text-sm font-medium z-10">{day}</span>
              
              {/* Note Priority Indicators */}
              <div className="flex space-x-0.5 justify-center mt-auto w-full px-1 min-h-[6px]">
                {hasHigh && (
                  <span className={`w-1.5 h-1.5 rounded-full ${selected ? "bg-white" : "bg-rose-500"}`} />
                )}
                {hasMedium && (
                  <span className={`w-1.5 h-1.5 rounded-full ${selected ? "bg-white" : "bg-amber-500"}`} />
                )}
                {hasLow && (
                  <span className={`w-1.5 h-1.5 rounded-full ${selected ? "bg-white" : "bg-emerald-500"}`} />
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Mini Agenda Info */}
      <div className="mt-4 pt-3 border-t border-slate-50 text-xs text-slate-400 flex items-center justify-between">
        <div className="flex space-x-3">
          <span className="flex items-center space-x-1">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
            <span>Alta</span>
          </span>
          <span className="flex items-center space-x-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            <span>Media</span>
          </span>
          <span className="flex items-center space-x-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span>Baja</span>
          </span>
        </div>
        <div className="flex items-center text-slate-500">
          <AlertCircle className="w-3.5 h-3.5 mr-1 text-indigo-500" />
          <span>Toca un día para agendar</span>
        </div>
      </div>
    </div>
  );
}
