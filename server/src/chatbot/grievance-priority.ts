export type GrievancePriority = 'high' | 'normal';

const HIGH = [
  'urgent',
  'emergency',
  'accident',
  'died',
  'death',
  'flood',
  'fire',
  'no water',
  'drinking water',
  'electricity',
  'power cut',
  'current cut',
  'attack',
  'blood',
  'ambulance',
  'hospital',
  'danger',
  'suicide',
  'protest',
  'riot',
  'collapse',
  'injury',
  'injured',
  'not working',
  'అత్యవసర',
  'ప్రమాద',
  'మరణ',
  'వరద',
  'అగ్ని',
  'నీళ్లు',
  'కరెంట్',
];

/** Roman Telugu is read only to judge priority and the department. The typed words stay unchanged. */
const ROMAN_TELUGU: Array<[RegExp, string]> = [
  [/\b(atyavasaram|athi avasaram|avasaram)\b/g, ' urgent '],
  [/\b(pramadham|pramadam|pramaadam)\b/g, ' accident '],
  [/\b(maranam|chanipoyadu|chanipoyindi)\b/g, ' death '],
  [/\b(varadha|varada|varadham)\b/g, ' flood '],
  [/\b(agni|mantu)\b/g, ' fire '],
  [/\b(neellu|neelu|nillu|neeru)\b/g, ' drinking water '],
  [/\b(karentu|kaarent|currentu)\b/g, ' electricity '],
  [/\b(aasupatri|asupatri|dawakhana)\b/g, ' hospital '],
  [/\b(roadu|roddu|rodhdu)\b/g, ' road '],
  [/\b(lightlu|laitlu)\b/g, ' light '],
  [/\b(penshan|penshanu)\b/g, ' pension '],
  [
    /\b(levu|ledu|leru|ledhu|bagaledu|baagaledu|padipoyindi)\b/g,
    ' not working ',
  ],
];

function understood(value: string): string {
  let text = ` ${value.toLowerCase()} `;
  for (const [pattern, meaning] of ROMAN_TELUGU)
    text = text.replace(pattern, meaning);
  return text;
}

/** High when the words describe an urgent problem. Otherwise normal. */
export function classifyGrievance(value: string): {
  priority: GrievancePriority;
  sentiment: 'negative' | 'neutral';
} {
  const hay = understood(value);
  const high = HIGH.some((word) => hay.includes(word));
  return {
    priority: high ? 'high' : 'normal',
    sentiment: high ? 'negative' : 'neutral',
  };
}

export function priorityLabel(priority: GrievancePriority): string {
  return priority === 'high' ? 'High priority' : 'Normal';
}

export type GrievanceLanguage = 'en' | 'te';

const PLACES = [
  'Narasaraopet',
  'Chilakaluripet',
  'Sattenapalle',
  'Vinukonda',
  'Gurazala',
  'Macherla',
  'Pedakurapadu',
];

export const DESKS: Array<{
  words: string[];
  name: string;
  nameTe: string;
  leader: string;
  place: string;
}> = [
  {
    words: ['water', 'drinking', 'నీళ', 'నీరు'],
    name: 'Water supply',
    nameTe: 'నీటి సరఫరా',
    leader: 'Ramesh',
    place: 'Narasaraopet',
  },
  {
    words: ['road', 'రోడ్డు', 'drain'],
    name: 'Roads and buildings',
    nameTe: 'రోడ్లు మరియు భవనాలు',
    leader: 'Lakshmi',
    place: 'Narasaraopet',
  },
  {
    words: ['light', 'electric', 'power', 'current', 'కరెంట్', 'లైట్'],
    name: 'Electricity',
    nameTe: 'విద్యుత్',
    leader: 'Srinivas',
    place: 'Chilakaluripet',
  },
  {
    words: ['hospital', 'health', 'ambulance', 'ఆసుపత్రి', 'వైద్య'],
    name: 'Medical and health',
    nameTe: 'వైద్యం మరియు ఆరోగ్యం',
    leader: 'Padma',
    place: 'Vinukonda',
  },
  {
    words: ['pension', 'ration', 'పెన్షన్'],
    name: 'Revenue',
    nameTe: 'రెవెన్యూ',
    leader: 'Koteswara Rao',
    place: 'Sattenapalle',
  },
];

export const GENERAL_DESK = {
  name: 'General administration',
  nameTe: 'సాధారణ పరిపాలన',
  leader: 'Suresh',
  place: 'Narasaraopet',
};

export function messageLanguage(value: string): GrievanceLanguage {
  return /[\u0C00-\u0C7F]/.test(value) ? 'te' : 'en';
}

export function grievanceReceipt(language: GrievanceLanguage): string {
  return language === 'te'
    ? 'మీ సమస్య అందింది. దీనిని పరిశీలించి పరిష్కరిస్తాము.'
    : 'Your problem is received. It will be reviewed and solved.';
}

/** Every department approval notice goes to this WhatsApp number. */
export const DEPARTMENT_WHATSAPP = '+918919537879';

export function raiserApproval(language: GrievanceLanguage): string {
  return language === 'te'
    ? 'మీ సమస్య ఆమోదించబడింది. త్వరలో పరిష్కరించబడుతుంది.'
    : 'Your grievance has been approved. It will be resolved soon.';
}

/** Sent to the named leader when the grievance is approved. */
export function leaderApproval(issue: string, desk: GrievanceDesk): string {
  const text = issue
    .replace(/\+?\d[\d\s-]{7,}\d/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (messageLanguage(issue) === 'te') {
    return `ఈ సమస్య ఆమోదించబడింది. దయచేసి త్వరలో పరిష్కరించండి.\n\nశాఖ: ${desk.department}\nప్రాంతం: ${desk.place}\nసమస్య: ${text}\nసంప్రదించాల్సిన నాయకుడు: ${desk.leader}`;
  }
  return `This grievance has been approved. Please see that it is resolved soon.\n\nDepartment: ${desk.department}\nLocation: ${desk.place}\nIssue: ${text}\nLeader to contact: ${desk.leader}`;
}

export function leaderUpdate(language: GrievanceLanguage): string {
  return language === 'te'
    ? 'మీ సమస్యను పరిష్కరిస్తున్నాము. కొన్ని రోజుల్లో లేదా వీలైనంత త్వరగా పరిష్కారం అవుతుంది. ధన్యవాదాలు.'
    : 'Your problem is being addressed. It will be solved in a few days, or as early as possible. Thank you.';
}

/** Sent to the named leader. When that leader has no number, it goes to the department number. */
export function leaderNotice(issue: string, desk: GrievanceDesk): string {
  const text = issue
    .replace(/\+?\d[\d\s-]{7,}\d/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (messageLanguage(issue) === 'te') {
    return `మీరు ఈ సమస్యకు సంప్రదించాల్సిన నాయకుడు: ${desk.leader}. దీన్ని వీలైనంత త్వరగా పరిష్కరించండి.\n\nశాఖ: ${desk.department}\nప్రాంతం: ${desk.place}\nసమస్య: ${text}`;
  }
  return `You are the leader to contact for this issue: ${desk.leader}. Please solve it as early as possible.\n\nDepartment: ${desk.department}\nLocation: ${desk.place}\nIssue: ${text}`;
}

export interface GrievanceDesk {
  department: string;
  leader: string;
  place: string;
}

/** Sample department and leader for a grievance. Every department is reached on the same follow-up number. */
export function assignDesk(value: string): GrievanceDesk {
  const hay = understood(value);
  const desk =
    DESKS.find((item) => item.words.some((word) => hay.includes(word))) ||
    GENERAL_DESK;
  const named = PLACES.find((place) => hay.includes(place.toLowerCase()));
  return {
    department: messageLanguage(value) === 'te' ? desk.nameTe : desk.name,
    leader: desk.leader,
    place: named || desk.place,
  };
}

export function departmentOrder(
  issue: string,
  desk: GrievanceDesk,
  progressUrl?: string,
): string {
  const text = issue
    .replace(/\+?\d[\d\s-]{7,}\d/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const inChatNotice = messageLanguage(issue) === 'te'
    ? '\n\n📲 వాట్సాప్‌లోనే పురోగతిని అప్‌డేట్ చేయండి: #progress అని రిప్లై ఇవ్వండి'
    : '\n\n📲 Update progress natively in WhatsApp: Reply #progress';
  const link = progressUrl
    ? messageLanguage(issue) === 'te'
      ? `\n\nUpdate the work progress:\n${progressUrl}`
      : `\n\nUpdate the work progress:\n${progressUrl}`
    : '';
  if (messageLanguage(issue) === 'te') {
    return `దీన్ని వెంటనే పరిష్కరించాలి.\n\nశాఖ: ${desk.department}\nప్రాంతం: ${desk.place}\nసమస్య: ${text}\nసంప్రదించాల్సిన నాయకుడు: ${desk.leader}${inChatNotice}${link}`;
  }
  return `Need to solve this immediately.\n\nDepartment: ${desk.department}\nLocation: ${desk.place}\nIssue: ${text}\nLeader to contact: ${desk.leader}${inChatNotice}${link}`;
}

/** Sample issues. The person who raised each one is split between Bobby and Sravani. */
export const MOCK_GRIEVANCES: Array<{
  title: string;
  detail: string;
  priority: GrievancePriority;
  reporter: string;
}> = [
  {
    title: 'No drinking water',
    detail: 'Vinukonda colony has had no water for two days.',
    priority: 'high',
    reporter: 'Bobby',
  },
  {
    title: 'Road damage',
    detail: 'The main road near Narasaraopet bus stand is broken.',
    priority: 'high',
    reporter: 'Sravani',
  },
  {
    title: 'Street lights',
    detail: 'Lights are out on the Chilakaluripet market road.',
    priority: 'normal',
    reporter: 'Bobby',
  },
  {
    title: 'Pension delay',
    detail: 'A pension has not arrived in Sattenapalle this month.',
    priority: 'normal',
    reporter: 'Sravani',
  },
];
