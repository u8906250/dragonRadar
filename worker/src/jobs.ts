/**
 * 狗狗陪伴模組：判讀兩種刊登：徵人（飼主、店家找人照顧、陪伴、遛狗）、可照顧（個人說可以幫忙照顧、寄宿、遛狗），
 * 抽出地點、期間、每天時段、薪資或費用、雇主、怎麼聯絡。
 * 這類徵才常有假職缺（只留表單、要加 LINE、要先付錢），判讀時順便標出風險，畫面上提醒。
 */
import { conf, parseLoose, str, type ExtractedEvent, type Extraction, type ExtractSpec, type JobInfo } from './extract';

const MAX_JOBS = 6;

const JOB_PROMPT = `你是「狗狗陪伴雷達」的資料抽取器。你會收到一則台灣 Threads 貼文，判斷它是不是下面兩種刊登之一，並抽出資訊：
- hire（徵人）：飼主、店家在找人照顧、陪伴、遛狗或照顧其他寵物（狗狗陪伴員、寵物保姆、遛狗員、到府照顧、寄宿幫手）。
- offer（可照顧）：個人說自己可以幫忙照顧、寄宿、寄養、遛狗、陪伴別人的狗狗或寵物，免費或收費都算（例如「喜歡狗狗，可以免費幫忙短期寄宿」）。

只輸出 JSON：
{
  "is_job": 是否是上面兩種刊登之一（布林值）,
  "jobs": [ 每個地點一筆，最多 ${MAX_JOBS} 筆 ]
}

jobs 每筆的欄位：
- role: "hire" 或 "offer"
- title: 16 字以內的短標題，地點加內容，例如「大安區狗狗陪伴員」「信義區遛狗員」「台中市區免費寄宿照顧」
- place_text: 貼文原文中的工作地點
- place_query: 給地圖搜尋用。有門牌就用門牌並補上縣市（例如「台北市大安區忠孝東路三段268號」）；只寫區就寫「台北市 大安區」；沒寫地點則 null
- work_from: 工作期間第一天，YYYY-MM-DD；「11/20-11/30」的第一天是 11/20；相對日期以發文時間換算；沒寫則 null
- work_to: 工作期間最後一天，YYYY-MM-DD；沒寫則 null
- slots: 每天的工作時段，24 小時制，例如「上午 9:00－12:00 下午 15:00－18:00」→ ["09:00-12:00", "15:00-18:00"]；沒寫則 []
- pay: 薪資或費用原文，例如「時薪 300 元」「一天 1500 元」「免費」；沒寫則 null
- employer: hire 填雇主、店家、公司或單位的名稱；offer 填提供照顧的店家或單位名稱（個人則 null）；只寫「僱主」「飼主」「我們」沒寫名字則 null
- contact: 怎麼聯絡：form（填表單、Google 表單）、line（加 LINE、LINE ID）、dm（私訊、留言）、phone（打電話）、email、other；沒寫則 null
- requirements: 工作內容與條件（offer 是可以照顧的方式與條件，例如「飼主自備飼料、用品」）的摘要，30 字以內；沒寫則 null
- confidence: 0 到 1 的信心分數

規則：
- 寵物旅館、美容、訓練等店家的服務廣告、寵物用品廣告、領養、走失協尋、寵物活動、心得分享，is_job 為 false，jobs 為空陣列。
- offer 只寫到城市或區（例如「台中市區」）也可以：place_query 填「台中市」這種最具體的地名。
- 不要編造貼文裡沒有的資訊。`;

const JOB_SCHEMA = {
  type: 'object',
  properties: {
    is_job: { type: 'boolean' },
    jobs: {
      type: 'array',
      maxItems: MAX_JOBS,
      items: {
        type: 'object',
        properties: {
          role: { type: 'string', enum: ['hire', 'offer'] },
          title: { type: 'string' },
          place_text: { type: ['string', 'null'] },
          place_query: { type: ['string', 'null'] },
          work_from: { type: ['string', 'null'] },
          work_to: { type: ['string', 'null'] },
          slots: { type: 'array', items: { type: 'string' } },
          pay: { type: ['string', 'null'] },
          employer: { type: ['string', 'null'] },
          contact: { type: ['string', 'null'] },
          requirements: { type: ['string', 'null'] },
          confidence: { type: 'number' },
        },
        required: ['role', 'title', 'place_text', 'place_query', 'work_from', 'work_to', 'slots', 'pay', 'employer', 'contact', 'requirements', 'confidence'],
      },
    },
  },
  required: ['is_job', 'jobs'],
};

const CONTACTS = new Set(['form', 'line', 'dm', 'phone', 'email', 'other']);
/** 「僱主」「飼主」「我們」這種沒有名字的稱呼不算寫了雇主（模型常照抄） */
const NAMELESS_EMPLOYER = /^(?:僱主|雇主|飼主|主人|狗主人|毛孩家長|家長|我們|我|本人|屋主|業主|老闆|案主|委託人|個人|私人)$/;
export const employerName = (v: unknown): string | null => {
  const s = str(v);
  return s && !NAMELESS_EMPLOYER.test(s.replace(/\s/g, '')) ? s : null;
};
const day = (v: unknown): string | null => (/^\d{4}-\d{2}-\d{2}/.test(str(v) ?? '') ? (str(v) as string).slice(0, 10) : null);

/** 「9:00－12:00」「09:00 - 12:00」整理成「09:00-12:00」；看不懂的丟掉 */
export function normalizeSlot(v: unknown): string | null {
  const m = /^(\d{1,2})[:：](\d{2})\s*[-－~～–到至]\s*(\d{1,2})[:：](\d{2})$/.exec((str(v) ?? '').trim());
  if (!m) return null;
  const hm = (h: string, mm: string): string => `${h.padStart(2, '0')}:${mm}`;
  return `${hm(m[1], m[2])}-${hm(m[3], m[4])}`;
}

export function normalizeJobs(raw: unknown): Extraction | null {
  const obj = parseLoose(raw);
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  const isJob = o.is_job === true || o.is_job === 'true';
  const list = Array.isArray(o.jobs) ? o.jobs.filter((j): j is Record<string, unknown> => !!j && typeof j === 'object' && !Array.isArray(j)).slice(0, MAX_JOBS) : [];
  const events: ExtractedEvent[] = list.map((j) => {
    const contact = (str(j.contact) ?? '').toLowerCase();
    const job: JobInfo = {
      role: str(j.role)?.toLowerCase() === 'offer' ? 'offer' : 'hire',
      work_from: day(j.work_from),
      work_to: day(j.work_to),
      slots: Array.isArray(j.slots) ? j.slots.map(normalizeSlot).filter((s): s is string => !!s) : [],
      pay: str(j.pay),
      employer: employerName(j.employer),
      contact: CONTACTS.has(contact) ? contact : null,
      requirements: str(j.requirements),
    };
    return {
      kind: 'job',
      title: str(j.title) ?? (str(j.role)?.toLowerCase() === 'offer' ? '可幫忙照顧狗狗' : '狗狗陪伴員'),
      item: job.pay,
      start_at: null,
      end_at: null,
      place_text: str(j.place_text),
      place_query: str(j.place_query),
      confidence: conf(j.confidence),
      spot: false,
      until: null,
      job,
    };
  });
  return { is_event: isJob, events: isJob ? events : [] };
}

/** 狗狗陪伴的判讀 */
export const JOB_SPEC: ExtractSpec = { system: JOB_PROMPT, schema: JOB_SCHEMA, normalize: normalizeJobs };

/**
 * 防詐提醒：從判讀結果和貼文看出的可疑之處（畫面上列出來提醒，不擋）
 * - no_employer：沒寫雇主、單位名稱
 * - form_only：只留表單，沒有電話也沒有單位名稱（常見蒐集個資的手法）
 * - line_only：只要加 LINE，沒有電話也沒有單位名稱
 * - money：提到保證金、先付款、提款卡、帳戶、代收代付
 */
export type JobRisk = 'no_employer' | 'form_only' | 'line_only' | 'money';

const PHONE_RE = /(?:0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}|09\d{2}[-\s]?\d{3}[-\s]?\d{3})/;
const FORM_RE = /表單|forms\.gle|docs\.google\.com\/forms|填單/i;
const LINE_RE = /加\s*(?:line|賴)|line\s*(?:id|帳號|[:：])|官方帳號/i;
const MONEY_RE = /保證金|押金|先匯|先付|預付|代墊|提款卡|存摺|網銀|帳戶|代收|代付|點數卡|遊戲點數/;

export function jobRisks(job: JobInfo, text: string): JobRisk[] {
  // 可照顧（個人說可以幫忙）：雇主、表單、LINE 這些是看徵人的，只看有沒有提到先付錢
  if (job.role === 'offer') return MONEY_RE.test(text) ? ['money'] : [];
  const risks: JobRisk[] = [];
  const phone = PHONE_RE.test(text) || job.contact === 'phone';
  if (!job.employer) risks.push('no_employer');
  if (!phone && !job.employer && (job.contact === 'form' || FORM_RE.test(text))) risks.push('form_only');
  if (!phone && !job.employer && (job.contact === 'line' || LINE_RE.test(text))) risks.push('line_only');
  if (MONEY_RE.test(text)) risks.push('money');
  return risks;
}
