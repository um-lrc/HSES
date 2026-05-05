
export enum PersonaType {
  ADVISOR = 'ADVISOR',
  DEAN = 'DEAN',
  HIRING_MANAGER = 'HIRING_MANAGER',
  GRANT_REVIEWER = 'GRANT_REVIEWER',
  COMMITTEE_CHAIR = 'COMMITTEE_CHAIR',
  PEER_COLLABORATOR = 'PEER_COLLABORATOR',
  JOURNAL_EDITOR = 'JOURNAL_EDITOR',
  ETHICS_OFFICER = 'ETHICS_OFFICER',
  ADMISSIONS_DEAN = 'ADMISSIONS_DEAN',
  DEPARTMENT_HEAD = 'DEPARTMENT_HEAD',
  OMBUDS_OFFICER = 'OMBUDS_OFFICER',
  FACULTY_MENTOR = 'FACULTY_MENTOR'
}

export interface Scenario {
  id: string;
  title: string;
  context: string;
  systemPrompt: string;
  embeddedContext?: string;
  hints: string[];
}

export interface PersonaProfile {
  name: string;
  title: string;
  department?: string;
  background: string;
  communicationStyle: string;
  keyConcerns: string[];
  tipsForInteraction: string[];
  biography: string;
}

export interface RubricItem {
  criterion: string;
  points: number;
}

export interface Persona {
  id: PersonaType;
  name: string;
  title: string;
  description: string;
  visualDescription?: string;
  goal: string;
  rubric?: RubricItem[];
  systemInstruction: string;
  embeddedContext?: string;
  avatar: string;
  voiceName: 'Kore' | 'Puck' | 'Charon' | 'Fenrir' | 'Zephyr';
  scenarios: Scenario[];
  profile?: PersonaProfile;
}

export interface Message {
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  feedback?: Feedback;
  isFlagged?: boolean;
  audioUrl?: string;
}

export interface Feedback {
  rating: number; // 1-5
  clarity: boolean;
  relevance: boolean;
  helpfulness: boolean;
  comments: string;
  timestamp: number;
}

export interface SessionState {
  isActive: boolean;
  mode: 'text' | 'voice';
  persona: Persona | null;
  scenario: Scenario | null;
  requestFeedback: boolean;
  messages: Message[];
  isTyping: boolean;
  isListening: boolean;
  isSpeaking: boolean;
  transcript: string;
  showTranscript: boolean;
  feedback: Feedback | null;
  initialMessages?: Message[];
}
