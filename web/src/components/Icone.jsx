// Ícones por nome (as constantes guardam o nome como string).
import {
  Activity, AlertTriangle, BellRing, Bot, Building2, CalendarClock, HelpCircle, Inbox, Info,
  LayoutGrid, MessageSquareReply, Reply, ScrollText, Send, ShieldQuestion, User, Mail, FileText,
  Settings2, Zap, BookOpen, ChevronLeft, ChevronRight, Sparkles, Flame, Timer, Trophy, PieChart,
} from "lucide-react";

const MAPA = {
  Activity, AlertTriangle, BellRing, Bot, Building2, CalendarClock, HelpCircle, Inbox, Info,
  LayoutGrid, MessageSquareReply, Reply, ScrollText, Send, ShieldQuestion, User, Mail, FileText,
  Settings2, Zap, BookOpen, ChevronLeft, ChevronRight, Sparkles, Flame, Timer, Trophy, PieChart,
};

export default function Icone({ nome, size = 16, ...resto }) {
  const C = MAPA[nome] || Info;
  return <C size={size} aria-hidden="true" {...resto} />;
}
