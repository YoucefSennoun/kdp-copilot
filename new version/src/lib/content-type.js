/**
 * KDP-Publishable Content-Type classifier (Phase 1.5 / Gap E).
 *
 * Decides whether a keyword's niche is something an indie KDP publisher can
 * realistically produce — low-content (journals, planners, logbooks, notebooks,
 * calendars, trackers), medium-content (coloring / activity / puzzle /
 * guided-workbook), personalized/name-variant, researched-and-compiled guides,
 * and — when `allowFiction` is on — SPECIFIC long-tail fiction niches
 * ("cozy mysteries for seniors") — versus high-content work that requires
 * being a novelist, memoirist, or subject-matter expert (medical, biological,
 * scientific, technical, legal, academic non-fiction, and writer-craft books).
 *
 * Signals (in descending strength):
 *   1. keyword text  — strongest; a "journal"/"coloring book" keyword wins even
 *      if some competitor titles look like fiction.
 *   2. sample titles  — majority verdict across the top scraped cards.
 *   3. category breadcrumbs (from BSR enrichment) — a novel or a clinical text
 *      usually lives under Literature/Fiction or Medical categories.
 *   4. Kindle-format availability — blank-interior books rarely get Kindle
 *      editions, so a low Kindle share is a low/medium-content tell.
 *
 * Pure module: no chrome APIs, safe to unit-test.
 */

const LOW_KIND = {
  low: 'low-content',
  medium: 'medium-content',
  guide: 'guide',
  personalized: 'personalized',
  rule8: 'rule8-content'
};

/**
 * Content scope (rules v1). 'rule8' = the rules-v1 publishable list:
 * Low-Content families PLUS the "Not Generally Low-Content" families
 * (puzzle books, coloring books, photography, sheet music, manuals,
 * textbooks, children's books). 'strict' = Amazon's official blank-interior
 * list only. 'standard' = rule8 plus guides and narrow fiction.
 */
export const CONTENT_SCOPE = {
  STRICT: 'strict',
  RULE8: 'rule8',
  STANDARD: 'standard'
};

/** True when a classifyContentType result is a plain blank-interior niche. */
export function isLowContentNiche(result) {
  return !!result && result.contentType === 'low-content';
}

/** Rules-v1 scope decision: rule8 allows low + medium + the rule-8 families. */
export function isRule8Allowed(result) {
  if (!result) return false;
  if (result.contentType === 'high-content-excluded' || result.requiresExpertise) return false;
  return ['low-content', 'medium-content', 'personalized', 'rule8-content'].includes(result.contentType);
}

/** Pure scope-decision used by the storage scrub and the dashboard gate. */
export function scopeAllows(result, scope = CONTENT_SCOPE.RULE8) {
  if (!result) return false;
  if (scope === CONTENT_SCOPE.STRICT) return isLowContentNiche(result);
  if (scope === CONTENT_SCOPE.RULE8) return isRule8Allowed(result);
  return result.contentType !== 'high-content-excluded' && !result.requiresExpertise;
}

/**
 * KDP-friendly content signals, each ~ a kind ('low' | 'medium' | 'guide').
 * Longest/most specific phrases should come before short generic ones when
 * they share words (first match wins for the label).
 */
export const LOW_MEDIUM_SIGNALS = [
  // --- Distinctively low-content ---
  { phrase: 'guest book', label: 'Guest Book', kind: 'low' },
  { phrase: 'record book', label: 'Record Book', kind: 'low' },
  { phrase: 'memory book', label: 'Memory Book', kind: 'low' },
  { phrase: 'keepsake', label: 'Keepsake Book', kind: 'low' },
  { phrase: 'ledger', label: 'Ledger', kind: 'low' },
  { phrase: 'log book', label: 'Logbook', kind: 'low' },
  { phrase: 'logbook', label: 'Logbook', kind: 'low' },
  { phrase: 'flight log', label: 'Logbook', kind: 'low' },
  { phrase: 'reading log', label: 'Logbook', kind: 'low' },
  { phrase: 'workout log', label: 'Logbook', kind: 'low' },
  { phrase: 'symptom log', label: 'Logbook', kind: 'low' },
  { phrase: 'tracking log', label: 'Logbook', kind: 'low' },
  { phrase: 'food log', label: 'Logbook', kind: 'low' },
  { phrase: 'cord wood log', label: 'Logbook', kind: 'low' },
  { phrase: 'daily log', label: 'Logbook', kind: 'low' },
  { phrase: 'journal', label: 'Journal', kind: 'low' },
  { phrase: 'diary', label: 'Diary', kind: 'low' },
  { phrase: 'notebook', label: 'Notebook', kind: 'low' },
  { phrase: 'planner', label: 'Planner', kind: 'low' },
  { phrase: 'meal planner', label: 'Meal Planner', kind: 'low' },
  { phrase: 'budget planner', label: 'Budget Planner', kind: 'low' },
  { phrase: 'weekly planner', label: 'Planner', kind: 'low' },
  { phrase: 'calendar', label: 'Calendar', kind: 'low' },
  { phrase: 'tracker', label: 'Tracker', kind: 'low' },
  { phrase: 'habit tracker', label: 'Tracker', kind: 'low' },
  { phrase: 'mood tracker', label: 'Tracker', kind: 'low' },
  { phrase: 'period tracker', label: 'Tracker', kind: 'low' },
  { phrase: 'water tracker', label: 'Tracker', kind: 'low' },
  { phrase: 'gratitude', label: 'Gratitude Journal', kind: 'low' },
  { phrase: 'manifestation', label: 'Manifestation Journal', kind: 'low' },
  { phrase: 'prompts', label: 'Prompt Journal', kind: 'low' },
  { phrase: 'prompt book', label: 'Prompt Journal', kind: 'low' },
  { phrase: 'sketchbook', label: 'Sketchbook', kind: 'low' },
  { phrase: 'sketch book', label: 'Sketchbook', kind: 'low' },
  { phrase: 'dot grid', label: 'Notebook', kind: 'low' },
  { phrase: 'bullet journal', label: 'Bullet Journal', kind: 'low' },
  { phrase: 'vision board', label: 'Vision Board Book', kind: 'low' },
  { phrase: 'book of shadows', label: 'Journal', kind: 'low' },

  // --- Non-English low-content family names ---
  { phrase: 'cahier', label: 'Cahier / Notebook', kind: 'low' },
  { phrase: 'carnet', label: 'Carnet / Notebook', kind: 'low' },
  { phrase: 'cuaderno', label: 'Cuaderno / Notebook', kind: 'low' },
  { phrase: 'hefte', label: 'Heft / Notebook', kind: 'low' },
  { phrase: 'quaderno', label: 'Quaderno / Notebook', kind: 'low' },
  { phrase: 'notizheft', label: 'Notizheft / Notebook', kind: 'low' },
  { phrase: 'carnet de', label: 'Carnet / Notebook', kind: 'low' },
  { phrase: 'cahier de', label: 'Cahier / Notebook', kind: 'low' },
  { phrase: 'cuaderno de', label: 'Cuaderno / Notebook', kind: 'low' },
  { phrase: 'tagebuch', label: 'Tagebuch / Diary', kind: 'low' },
  { phrase: 'kalender', label: 'Kalender / Calendar', kind: 'low' },
  { phrase: 'agenda', label: 'Agenda / Planner', kind: 'low' },
  { phrase: 'planificateur', label: 'Planificateur / Planner', kind: 'low' },
  { phrase: 'organizer', label: 'Organizer / Planner', kind: 'low' },
  { phrase: 'diario', label: 'Diario / Diary', kind: 'low' },
  { phrase: 'caderno', label: 'Caderno / Notebook', kind: 'low' },
  { phrase: 'calendario', label: 'Calendario / Calendar', kind: 'low' },
  { phrase: 'livre de coloriage', label: 'Coloring Book', kind: 'medium' },
  { phrase: 'malbuch', label: 'Malbuch / Coloring Book', kind: 'medium' },
  { phrase: 'buch der rätsel', label: 'Puzzle Book', kind: 'medium' },
  { phrase: 'übungsheft', label: 'Übungsheft / Workbook', kind: 'medium' },
  { phrase: 'cahier dexercices', label: 'Cahier dexercices / Workbook', kind: 'medium' },

  // --- Strict low-content (Amazon's "generally low-content" list) ---
  { phrase: 'coupon book', label: 'Coupon Book', kind: 'low' },
  { phrase: 'coupon holder', label: 'Coupon Book', kind: 'low' },
  { phrase: 'score card', label: 'Score Card Templates', kind: 'low' },
  { phrase: 'scorecard', label: 'Score Card Templates', kind: 'low' },
  { phrase: 'score cards', label: 'Score Card Templates', kind: 'low' },
  { phrase: 'score sheet', label: 'Score Sheet', kind: 'low' },
  { phrase: 'scoresheet', label: 'Score Sheet', kind: 'low' },
  { phrase: 'scrapbook paper', label: 'Crafting Templates', kind: 'low' },
  { phrase: 'scrapbooking', label: 'Crafting Templates', kind: 'low' },
  { phrase: 'ephemera', label: 'Crafting Templates', kind: 'low' },
  { phrase: 'card making templates', label: 'Crafting Templates', kind: 'low' },
  { phrase: 'crafting templates', label: 'Crafting Templates', kind: 'low' },
  { phrase: 'paper craft template', label: 'Crafting Templates', kind: 'low' },
  { phrase: 'stencil templates', label: 'Crafting Templates', kind: 'low' },
  { phrase: 'card making', label: 'Crafting Templates', kind: 'low' },
  { phrase: 'blank sheet music', label: 'Blank Sheet Music', kind: 'low' },
  { phrase: 'manuscript paper', label: 'Blank Sheet Music', kind: 'low' },
  { phrase: 'staff paper', label: 'Blank Sheet Music', kind: 'low' },
  { phrase: 'music manuscript', label: 'Blank Sheet Music', kind: 'low' },
  { phrase: 'blank music paper', label: 'Blank Sheet Music', kind: 'low' },
  { phrase: 'music writing paper', label: 'Blank Sheet Music', kind: 'low' },

  // --- Rules v1 (rule 8): "Not Generally Low-Content" families ---
  // kind 'rule8' = allowed in rule8 scope; excluded in strict scope.
  { phrase: 'photo book', label: 'Photography Book', kind: 'rule8' },
  { phrase: 'photography book', label: 'Photography Book', kind: 'rule8' },
  { phrase: 'coffee table book', label: 'Photography Book', kind: 'rule8' },
  { phrase: 'picture book of', label: 'Photography Book', kind: 'rule8' },
  { phrase: 'sheet music book', label: 'Sheet Music (published)', kind: 'rule8' },
  { phrase: 'songbook', label: 'Sheet Music (published)', kind: 'rule8' },
  { phrase: 'piano book', label: 'Sheet Music (published)', kind: 'rule8' },
  { phrase: 'guitar book', label: 'Sheet Music (published)', kind: 'rule8' },
  { phrase: 'music book', label: 'Sheet Music (published)', kind: 'rule8' },
  { phrase: 'owners manual', label: 'Manual', kind: 'rule8' },
  { phrase: 'user manual', label: 'Manual', kind: 'rule8' },
  { phrase: 'instruction manual', label: 'Manual', kind: 'rule8' },
  { phrase: 'textbook', label: 'Textbook', kind: 'rule8' },
  { phrase: 'text book', label: 'Textbook', kind: 'rule8' },
  { phrase: 'picture book', label: "Children's Book", kind: 'rule8' },
  { phrase: 'board book', label: "Children's Book", kind: 'rule8' },
  { phrase: 'early reader', label: "Children's Book", kind: 'rule8' },
  { phrase: 'bedtime story', label: "Children's Book", kind: 'rule8' },
  { phrase: 'bedtime stories', label: "Children's Book", kind: 'rule8' },
  { phrase: 'kids story', label: "Children's Book", kind: 'rule8' },
  { phrase: 'chapter book', label: "Children's Book", kind: 'rule8' },
  { phrase: 'chapter books', label: "Children's Book", kind: 'rule8' },
  { phrase: 'childrens book', label: "Children's Book", kind: 'rule8' },
  { phrase: "children's book", label: "Children's Book", kind: 'rule8' },
 
  // --- Medium-content: activity / coloring / puzzle / workbook ---
  { phrase: 'coloring book', label: 'Coloring Book', kind: 'medium' },
  { phrase: 'colour book', label: 'Coloring Book', kind: 'medium' },
  { phrase: 'coloring pages', label: 'Coloring Book', kind: 'medium' },
  { phrase: 'colouring', label: 'Coloring Book', kind: 'medium' },
  { phrase: 'coloring', label: 'Coloring Book', kind: 'medium' },
  { phrase: 'activity book', label: 'Activity Book', kind: 'medium' },
  { phrase: 'activities for', label: 'Activity Book', kind: 'medium' },
  { phrase: 'dot to dot', label: 'Activity Book', kind: 'medium' },
  { phrase: 'connect the dots', label: 'Activity Book', kind: 'medium' },
  { phrase: 'puzzle book', label: 'Puzzle Book', kind: 'medium' },
  { phrase: 'puzzles', label: 'Puzzle Book', kind: 'medium' },
  { phrase: 'puzzle', label: 'Puzzle Book', kind: 'medium' },
  { phrase: 'crossword', label: 'Crossword Book', kind: 'medium' },
  { phrase: 'word search', label: 'Word Search', kind: 'medium' },
  { phrase: 'word find', label: 'Word Search', kind: 'medium' },
  { phrase: 'sudoku', label: 'Sudoku Book', kind: 'medium' },
  { phrase: 'mazes', label: 'Maze Book', kind: 'medium' },
  { phrase: 'maze book', label: 'Maze Book', kind: 'medium' },
  { phrase: 'workbook', label: 'Workbook', kind: 'medium' },
  { phrase: 'flash cards', label: 'Flash Card Book', kind: 'medium' },
  { phrase: 'flashcards', label: 'Flash Card Book', kind: 'medium' },
  { phrase: 'handwriting practice', label: 'Practice Book', kind: 'medium' },
  { phrase: 'trace letters', label: 'Practice Book', kind: 'medium' },
  { phrase: 'cursive', label: 'Practice Book', kind: 'medium' },
  { phrase: 'kindergarten', label: 'Educational Activity', kind: 'medium' },
  { phrase: 'preschool', label: 'Educational Activity', kind: 'medium' },
  { phrase: 'for toddlers', label: "Children's Activity", kind: 'medium' },
  { phrase: 'for kids', label: "Children's Activity", kind: 'medium' },
  { phrase: 'for children', label: "Children's Activity", kind: 'medium' },

  // --- Guides & compiled non-fiction ---
  { phrase: 'study guide', label: 'Study Guide', kind: 'guide' },
  { phrase: 'complete guide', label: 'Guide', kind: 'guide' },
  { phrase: 'guide for', label: 'Guide', kind: 'guide' },
  { phrase: 'guide book', label: 'Guide', kind: 'guide' },
  { phrase: 'guide', label: 'Guide', kind: 'guide' },
  { phrase: 'cookbook', label: 'Cookbook', kind: 'guide' },
  { phrase: 'cook book', label: 'Cookbook', kind: 'guide' },
  { phrase: 'recipes', label: 'Cookbook', kind: 'guide' },
  { phrase: 'recipe book', label: 'Cookbook', kind: 'guide' },
  { phrase: 'meal prep', label: 'Cookbook', kind: 'guide' },
  { phrase: 'air fryer', label: 'Cookbook', kind: 'guide' },
  { phrase: 'instant pot', label: 'Cookbook', kind: 'guide' },
  { phrase: 'manual', label: 'Manual', kind: 'guide' },
  { phrase: 'handbook', label: 'Handbook', kind: 'guide' },
  { phrase: 'checklist', label: 'Checklist Book', kind: 'guide' },
  { phrase: 'templates', label: 'Template Book', kind: 'guide' },
  { phrase: 'declutter', label: 'Guide', kind: 'guide' },
  { phrase: 'decluttering', label: 'Guide', kind: 'guide' },
  { phrase: 'meal plan', label: 'Meal Plan Book', kind: 'guide' },
  { phrase: 'for beginners', label: 'Beginner Guide', kind: 'guide' },
  { phrase: 'how to', label: 'How-To Guide', kind: 'guide' },
  { phrase: '101', label: 'Collection', kind: 'guide' },
  { phrase: 'curriculum', label: 'Curriculum', kind: 'guide' }
];

export const PERSONALIZED_SIGNALS = [
  { phrase: 'personalized', label: 'Personalized' },
  { phrase: 'personalised', label: 'Personalized' },
  { phrase: 'custom name', label: 'Personalized' },
  { phrase: 'name book', label: 'Personalized' },
  { phrase: 'for a girl named', label: 'Personalized' },
  { phrase: 'for a boy named', label: 'Personalized' },
  { phrase: 'name search', label: 'Personalized' },
  { phrase: 'my daughter', label: 'Personalized' },
  { phrase: 'my son', label: 'Personalized' },
  { phrase: 'my granddaughter', label: 'Personalized' },
  { phrase: 'my grandson', label: 'Personalized' },
  { phrase: 'my niece', label: 'Personalized' },
  { phrase: 'my nephew', label: 'Personalized' },
  { phrase: 'my boyfriend', label: 'Personalized' },
  { phrase: 'my girlfriend', label: 'Personalized' },
  { phrase: 'my husband', label: 'Personalized' },
  { phrase: 'my wife', label: 'Personalized' },
  { phrase: 'my mom', label: 'Personalized' },
  { phrase: 'my dad', label: 'Personalized' },
  { phrase: 'gift for', label: 'Gift Book' },
  { phrase: 'letters to my', label: 'Personalized' }
];

/**
 * High-content signals: fiction/memoir AND expertise-required non-fiction.
 * expertise = true means the niche requires a professional credential (this
 * flips metrics.requiresExpertise).
 */
export const HIGH_CONTENT_SIGNALS = [
  // Fiction / narrative writing (excluded, not "expertise")
  { phrase: 'a novel', expertise: false },
  { phrase: 'novel', expertise: false },
  { phrase: 'novels', expertise: false },
  { phrase: 'fiction', expertise: false },
  { phrase: 'novelist', expertise: false },
  { phrase: 'short stories', expertise: false },
  { phrase: 'anthology', expertise: false },
  { phrase: 'memoir', expertise: false },
  { phrase: 'memoirs', expertise: false },
  { phrase: 'autobiography', expertise: false },
  { phrase: 'biography', expertise: false },
  { phrase: 'biographies', expertise: false },
  { phrase: 'essays', expertise: false },
  { phrase: 'essay collection', expertise: false },
  { phrase: 'poetry', expertise: false },
  { phrase: 'poem', expertise: false },
  { phrase: 'poems', expertise: false },
  { phrase: 'literary', expertise: false },
  { phrase: 'literature', expertise: false },
  { phrase: 'romance novel', expertise: false },
  { phrase: 'mystery novel', expertise: false },
  { phrase: 'drama', expertise: false },

  // Clinical / medical / scientific text (expertise required)
  { phrase: 'clinical', expertise: true },
  { phrase: 'diagnos*', expertise: true },
  { phrase: 'patholog*', expertise: true },
  { phrase: 'pathophysiology', expertise: true },
  { phrase: 'pharmacolog*', expertise: true },
  { phrase: 'pharmaceutical', expertise: true },
  { phrase: 'psychopharmacol*', expertise: true },
  { phrase: 'oncolog*', expertise: true },
  { phrase: 'cardiolog*', expertise: true },
  { phrase: 'neurolog*', expertise: true },
  { phrase: 'nephrolog*', expertise: true },
  { phrase: 'endocrinol*', expertise: true },
  { phrase: 'immunolog*', expertise: true },
  { phrase: 'dermatolog*', expertise: true },
  { phrase: 'obstetric*', expertise: true },
  { phrase: 'gynecolog*', expertise: true },
  { phrase: 'psychiatr*', expertise: true },
  { phrase: 'medical', expertise: true },
  { phrase: 'medicine', expertise: true },
  { phrase: 'physiolog*', expertise: true },
  { phrase: 'anatom*', expertise: true },
  { phrase: 'surger*', expertise: true },
  { phrase: 'biolog*', expertise: true },
  { phrase: 'physics', expertise: true },
  { phrase: 'chemistry', expertise: true },
  { phrase: 'mathematics', expertise: true },
  { phrase: 'anthropolog*', expertise: true },
  { phrase: 'genetics', expertise: true },
  { phrase: 'textbook', expertise: false },
  { phrase: 'text book', expertise: false },
  { phrase: 'dissertation', expertise: true },
  { phrase: 'thesis', expertise: true },
  { phrase: 'mcat', expertise: true },
  { phrase: 'usmle', expertise: true },
  { phrase: 'bar exam', expertise: true },
  { phrase: 'lsat', expertise: true },
  { phrase: 'naplex', expertise: true },
  { phrase: 'jurisprudence', expertise: true },
  { phrase: 'statute', expertise: true },
  { phrase: 'constitutional law', expertise: true },
  { phrase: 'forensic science', expertise: true },

  // Credential markers in titles
  { phrase: 'by dr', expertise: true },
  { phrase: 'by md', expertise: true },
  { phrase: 'm d', expertise: true },
  { phrase: 'ph d', expertise: true },

  // Writer-craft / publishing guides — books ABOUT becoming a writer sell to
  // the author audience, not to end-buyers of the niche. Deny unless a STRONG
  // low/medium family token coexists ("novel writing planner" is a real
  // planner; "how to write a book" is a high-content book).
  { phrase: 'write a book', expertise: false },
  { phrase: 'writing a book', expertise: false },
  { phrase: 'how to write', expertise: false },
  { phrase: 'how to publish', expertise: false },
  { phrase: 'become an author', expertise: false },
  { phrase: 'becoming an author', expertise: false },
  { phrase: 'for authors', expertise: false },
  { phrase: 'for writers', expertise: false },
  { phrase: 'book marketing', expertise: false },
  { phrase: 'author marketing', expertise: false },
  { phrase: 'self publishing', expertise: false },
  { phrase: 'self-publishing', expertise: false },
  { phrase: 'get published', expertise: false },
  { phrase: 'publishing guide', expertise: false },
  { phrase: 'author platform', expertise: false },
  { phrase: 'sell more books', expertise: false }
];

/**
 * Fiction sub-genre / audience framing that makes a NOVEL niche specific
 * enough to be its own long-tail product ("cozy mysteries for seniors" is a
 * niche; "romance novels" is not). Used ONLY for the narrow-fiction carve-out.
 */
export const FICTION_SUBGENRE_SIGNALS = [
  'cozy', 'cozy mystery', 'regency', 'paranormal', 'paranormal romance',
  'shifter', 'werewolf', 'vampire', 'sweet romance', 'gay romance',
  'lesbian romance', 'amish romance', 'norse', 'space opera', 'cyberpunk',
  'dystopian', 'litrpg', 'urban fantasy', 'slice of life', 'murder mystery',
  'beta-male', 'small town', 'instalove', 'enemies to lovers',
  'historical romance', 'dark romance', 'clean romance', 'wholesome',
  'cozy fantasy', 'romantasy', 'new adult', 'young adult',
  'chapter book', 'chapter books', 'bedtime story', 'bedtime stories',
  'fairy tale', 'fairy tales', 'nursery rhymes'
];

const FICTION_HEADWORDS = [
  'novel', 'novels', 'fiction', 'narrative', 'story book', 'storybook', 'romance'
];

/** "cozy mysteries for seniors" / "chapter books for girls" — narrow & specific. */
function isSpecificFictionKeyword(kw) {
  const words = String(kw || '').trim().split(/\s+/).filter(Boolean).length;
  const subgenre = FICTION_SUBGENRE_SIGNALS.some((p) => hasPhrase(kw, p));
  const audience =
    /\bfor\s+(women|men|adults|teens|seniors|kids|girls|boys|toddlers|children|couples|moms|dads|him|her|brides|grooms)\b/.test(kw) ||
    /\bfor\s+(\w+)\s+(readers|romance|mystery|listeners)\b/.test(kw);
  return words >= 3 && (subgenre || audience);
}

function isFictionish(kw) {
  return FICTION_HEADWORDS.some((p) => hasPhrase(kw, p)) ||
    FICTION_SUBGENRE_SIGNALS.some((p) => hasPhrase(kw, p));
}

/**
 * Category breadcrumb deny patterns (checked after BSR enrichment). Matching
 * text is case-insensitive; substrings are intentional.
 */
export const DENY_CATEGORY_PATTERNS = [
  /fiction/i,
  /literature/i,
  /novel/i,
  /mystery/i,
  /thriller/i,
  /horror/i,
  /fantasy/i,
  /romance/i,
  /poetry/i,
  /drama/i,
  /comic/i,
  /memoir/i,
  /biograph/i,
  /autobiograph/i,
  /textbook/i,
  /test prep/i,
  /exam prep/i,
  /medical/i,
  /clinical/i,
  /pharmaco/i,
  /patholog/i,
  /diagnos/i,
  /oncology/i,
  /cardiology/i,
  /neurolog/i,
  /psychiatr/i,
  /law\b/i,
  /legal/i,
  /engineering/i,
  /computer science/i,
  /physics/i,
  /chemistry/i,
  /biology/i,
  /mathematics/i,
  /political science/i,
  /philosophy/i,
  /history/i
];

export const ALLOW_CATEGORY_PATTERNS = [
  /journal/i,
  /planner/i,
  /notebook/i,
  /log/i,
  /diary/i,
  /calendar/i,
  /coloring/i,
  /colouring/i,
  /activity/i,
  /puzzle/i,
  /cooking/i,
  /recipe/i,
  /health.?fitness/i,
  /diet/i,
  /self.?help/i,
  /children/i,
  /crafts/i,
  /hobbies/i,
  /travel/i,
  /religion/i,
  /devotional/i,
  /study guide/i,
  /education/i,
  /reference/i
];

function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Word-anchored phrase match. A trailing '*' on the final token turns it into
 * a prefix match (e.g. 'diagnos*' matches "diagnosis", "diagnostic", …).
 */
function hasPhrase(text, phrase) {
  const tokens = String(phrase).split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  const parts = tokens.map((tok, i) => {
    const prefix = i === tokens.length - 1 && tok.endsWith('*');
    const body = esc(prefix ? tok.slice(0, -1) : tok);
    return i === 0 ? `\\b${body}` : `\\s+${body}` + (prefix ? '[\\w]*\\b' : '\\b');
  });
  return new RegExp(parts.join(''), 'i').test(text);
}

function normalize(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Count how many distinct inputs matched at least one of phrases. */
function countMatches(inputs, signals, matchFn) {
  let matched = 0;
  (inputs || []).forEach((input) => {
    if (signals.some((s) => hasPhrase(matchFn(input), s.phrase))) matched++;
  });
  return matched;
}

function dominantLowSignal(text) {
  for (const s of LOW_MEDIUM_SIGNALS) {
    if (hasPhrase(text, s.phrase)) return s;
  }
  return null;
}

/** Rule-8 scope: any non-high family qualifies (low, medium, rule8, guide-adjacent). */
function dominantRule8Signal(text) {
  for (const s of LOW_MEDIUM_SIGNALS) {
    if (s.kind !== 'guide' && hasPhrase(text, s.phrase)) return s;
  }
  return null;
}

/** Strict scope: only the kind==='low' candidates count. */
function dominantStrictLowSignal(text) {
  for (const s of LOW_MEDIUM_SIGNALS) {
    if (s.kind === 'low' && hasPhrase(text, s.phrase)) return s;
  }
  return null;
}

/**
 * Strict scope classification (v0.6). A niche qualifies ONLY if it is one of
 * Amazon's "generally low-content" blank-interior families. Everything else —
 * including coloring books, puzzle books, workbooks, guides, novels and
 * non-fiction — returns high-content-excluded so no pipeline stage can keep it.
 */
function strictScopeResult({ kw, kwLow, titles = [], categories = [], kindleShare = null, sampleSize = 0, nTitles = 0 }) {
  const pers = PERSONALIZED_SIGNALS.some((s) => hasPhrase(kw, s.phrase));
  if (pers) return result('low-content', 'Personalized / name book (blank interior)', 'title-regex', 'medium', false);

  const strictLow = kwLow.filter((s) => s.kind === 'low');
  if (strictLow.length) {
    const sig = dominantStrictLowSignal(kw);
    return result('low-content', sig ? sig.label : 'Low-Content', 'title-regex', 'high', false);
  }

  // Title-level majority (>=3 sampled cards).
  if (nTitles >= 3) {
    const lowTitles = countMatches(titles, LOW_MEDIUM_SIGNALS.filter((s) => s.kind === 'low'), (t) => t);
    const otherTitles = countMatches(titles, LOW_MEDIUM_SIGNALS.filter((s) => s.kind !== 'low'), (t) => t);
    if (lowTitles >= Math.max(3, Math.ceil(nTitles * 0.6)) && otherTitles <= lowTitles) {
      const sig = dominantStrictLowSignal(titles.join(' '));
      return result('low-content', (sig && sig.label) || 'Low-Content', 'title-regex', 'medium', false);
    }
    if (lowTitles >= 3 && lowTitles >= Math.ceil(nTitles * 0.4)) {
      const sig = dominantStrictLowSignal(titles.join(' '));
      return result('low-content', (sig && sig.label) || 'Low-Content', 'title-regex', 'medium', false);
    }
  }

  // Category breadcrumb confirming a blank-interior family.
  const catText = (categories || []).join(' ');
  if (catText && /journal|planner|notebook|notebooks|diary|logbook|tracking|calendar|sketch|prompt|coupon|score card|scrapbook|ephemera|manuscript|sheet music|tracker|paper$/i.test(catText)) {
    return result('low-content', 'Category-confirmed low-content', 'category-breadcrumb', 'low', false);
  }

  // The Kindle-format tell is intentionally NOT used here: it would wrongly
  // certify non-blank interiors. Unconfirmed => excluded (v0.6 focus rule).
  return result('high-content-excluded', 'Not general low-content', 'scope-strict', 'high', false);
}

function pick(a, b) {
  return a == null || a === '' ? b : a;
}

function result(contentType, label, source, confidence, requiresExpertise = false) {
  return { contentType, contentTypeLabel: label, contentTypeSource: source, confidence, requiresExpertise };
}

/**
 * Classify a niche's content production type.
 * @param {object} input
 * @param {string} input.keyword  - the niche keyword (strongest signal)
 * @param {string[]} input.titles - sampled competitor titles (weak signal)
 * @param {string[]} input.categories - category breadcrumb names (post-enrichment)
 * @param {number|null} input.kindleShare - 0-1 share of sample with Kindle edition
 * @param {number} input.sampleSize - scraped cards in the sample
 * @param {boolean} [input.allowFiction=true] - admit specific long-tail fiction niches
 * @returns {{contentType:string, contentTypeLabel:string, contentTypeSource:string,
 *            confidence:string, requiresExpertise:boolean}}
 */
export function classifyContentType({
  keyword = '',
  titles = [],
  categories = [],
  kindleShare = null,
  sampleSize = 0,
  allowFiction = true,
  scope = 'rule8'
} = {}) {
  const kw = normalize(keyword);
  const nTitles = (titles || []).length;
  const isStrict = scope === CONTENT_SCOPE.STRICT;

  // 1. Keyword-level personalized / low / medium / guide markers — strongest.
  if (hasPhrase(kw, 'personalized') || hasPhrase(kw, 'personalised') || hasPhrase(kw, 'gift for')) {
    if (isStrict) {
      return result('low-content', 'Personalized / name book (blank interior)', 'title-regex', 'medium', false);
    }
    return result('personalized', 'Personalized', 'title-regex', 'high');
  }
  const kwLow = LOW_MEDIUM_SIGNALS.filter((s) => hasPhrase(kw, s.phrase));
  const kwHigh = HIGH_CONTENT_SIGNALS.filter((s) => hasPhrase(kw, s.phrase));

  // 1b. STRICT scope: only blank-interior families qualify. Everything else —
  //     including coloring/puzzle/workbook/guides the standard scope allows —
  //     is excluded here and can be re-held by no later stage.
  if (isStrict) {
    return strictScopeResult({ kw, kwLow, titles, categories, kindleShare, sampleSize, nTitles });
  }

  // 1c. RULE8 scope (rules v1): low-content + puzzle + coloring + photography
  //     + published sheet music + manuals + textbooks + children's books.
  //     Guides, fiction, memoirs, expertise-required works stay excluded —
  //     rule 8 says "avoid novels or fiction or non-fiction books".
  if (scope === CONTENT_SCOPE.RULE8) {
    const rule8Hit = kwLow.find((s) => s.kind === 'rule8');
    const strongHit = kwLow.find((s) => s.kind === 'low' || s.kind === 'medium');
    const fictionish = isFictionish(kw);
    const anyExpert = kwHigh.some((s) => s.expertise);
    const writerCraft = /write a book|writing a book|how to write|how to publish|become an author|for authors|for writers|book marketing|author marketing|self[- ]?publishing|get published|publishing guide|author platform|sell more books/i.test(kw);

    // A rule8/low/medium family signal wins over overlaps ("math textbook"
    // is a textbook even though 'textbook' also appears in the high list).
    if (rule8Hit || strongHit) {
      const sig = dominantRule8Signal(kw) || dominantLowSignal(kw);
      return result(LOW_KIND[sig.kind] || 'medium-content', sig.label, 'title-regex', 'high', false);
    }

    // No family signal: fiction / expertise / writer-craft / generic all excluded.
    if (fictionish) {
      return result('high-content-excluded', 'Fiction / narrative (excluded by rules v1)', 'title-regex', 'high', false);
    }
    if (anyExpert) {
      return result('high-content-excluded', 'Expertise-required non-fiction', 'title-regex', 'high', true);
    }
    if (kwHigh.length || writerCraft) {
      return result('high-content-excluded', writerCraft ? 'Writer-craft / publishing guide' : 'High-content (non-family)', 'title-regex', 'high', false);
    }

    // Title-level verdict (>=3 sampled cards): rule8 family majority wins;
    // high-content domination excludes.
    if (nTitles >= 3) {
      const highMatches = countMatches(titles, HIGH_CONTENT_SIGNALS, (t) => t);
      const familyMatches = titles.filter((t) => dominantRule8Signal(t) || dominantLowSignal(t)).length;
      if (familyMatches >= Math.max(3, Math.ceil(nTitles * 0.3)) && familyMatches >= highMatches) {
        const sig = dominantRule8Signal(titles.join(' ')) || dominantLowSignal(titles.join(' '));
        return result(LOW_KIND[sig.kind] || 'medium-content', sig.label, 'title-regex', 'medium', false);
      }
      if (highMatches >= Math.max(3, Math.ceil(nTitles * 0.6)) && familyMatches < highMatches * 0.5) {
        return result('high-content-excluded', 'High-content titles dominate', 'title-regex', 'medium', false);
      }
    }

    // Category breadcrumbs: deny fiction/narrative/expertise categories.
    // Children's-book categories are rescuable only with a family signal at
    // the keyword level (checked above).
    const catTextR8 = (categories || []).join(' ');
    if (catTextR8) {
      if (DENY_CATEGORY_PATTERNS.some((re) => re.test(catTextR8)) && !/children/i.test(catTextR8)) {
        const expert = /medical|clinical|pharmaco|patholog|diagnos|oncology|cardiology|neurolog|psychiatr|law\b|legal|engineering|physics|chemistry|biology|mathematics|political science/i.test(catTextR8);
        return result('high-content-excluded', expert ? 'Lives under an expertise-required category' : 'Lives under a high-content category', 'category-breadcrumb', 'medium', expert);
      }
      if (/children/i.test(catTextR8)) {
        return result('rule8-content', "Children's books (category)", 'category-breadcrumb', 'medium', false);
      }
    }

    // Kindle-format tell: blank-interior/activity books rarely ship Kindle.
    if (kindleShare != null && sampleSize >= 4 && kindleShare < 0.15) {
      return result('low-content', 'No Kindle titles (interior / activity style)', 'format-signal', 'low', false);
    }

    // Unproven keywords don't qualify in rule8 scope — only explicit families.
    return result('high-content-excluded', 'Not in the rules-v1 publishable families', 'scope-rule8', 'high', false);
  }

  // 2. Keyword-level high-content markers — exclude unless a STRONG
  //    low/medium content signal genuinely coexists ("clinical trial logbook"
  //    is a real logbook; "clinical handbook of diabetes" is a real textbook).
  //    Strong = journal/planner/activity/workbook etc.; weak = guide-type.
  if (kwHigh.length || isFictionish(kw)) {
    const anyExpert = kwHigh.some((s) => s.expertise);
    const strongLow = kwLow.some((s) => s.kind !== 'guide');
    if (!strongLow) {
      // Narrow-fiction carve-out (Revision 2 / v0.5): a LONG-TAIL, audience-
      // specific fiction niche ("cozy mysteries for seniors", "chapter books
      // for girls") is a real, indie-producible product. Generic "romance
      // novels" is not. Only when the user allows fiction.
      if (!anyExpert && allowFiction && isFictionish(kw) && isSpecificFictionKeyword(kw)) {
        return result('fiction', 'Fiction niche (specific)', 'title-regex', 'medium', false);
      }
      const writerCraft = /write a book|writing a book|how to write|how to publish|become an author|for authors|for writers|book marketing|author marketing|self[- ]?publishing|get published|publishing guide|author platform|sell more books/i.test(kw);
      return result(
        'high-content-excluded',
        anyExpert ? 'Expertise-required non-fiction' : (writerCraft ? 'Writer-craft / publishing guide' : 'High-content (fiction / narrative)'),
        'title-regex',
        'high',
        anyExpert
      );
    }
  }

  if (kwLow.length) {
    const sig = dominantLowSignal(kw);
    return result(LOW_KIND[sig.kind] || 'guide', sig.label, 'title-regex', 'high');
  }

  // 3. Majority verdict across the sampled SERP titles (>=3 sampled cards).
  if (nTitles >= 3) {
    const highMatches = countMatches(titles, HIGH_CONTENT_SIGNALS, (t) => t);
    const lowMatches = countMatches(titles, LOW_MEDIUM_SIGNALS, (t) => t);
    if (highMatches >= Math.max(3, Math.ceil(nTitles * 0.6)) && lowMatches < highMatches * 0.5) {
      return result('high-content-excluded', 'High-content titles dominate', 'title-regex', 'medium');
    }
    if (lowMatches >= Math.max(3, Math.ceil(nTitles * 0.3))) {
      const sig = dominantLowSignal((titles || []).join(' '));
      return result(LOW_KIND[sig.kind] || 'guide', sig.label, 'title-regex', 'medium');
    }
  }

  // 4. Category breadcrumbs (post-BSR-enrichment).
  const catText = (categories || []).join(' ');
  if (catText) {
    if (DENY_CATEGORY_PATTERNS.some((re) => re.test(catText))) {
      const expert = /medical|clinical|pharmaco|patholog|diagnos|oncology|cardiology|neurolog|psychiatr|law\b|legal|engineering|physics|chemistry|biology|mathematics|political science/i.test(catText);
      return result(
        'high-content-excluded',
        expert ? 'Lives under an expertise-required category' : 'Lives under a high-content category',
        'category-breadcrumb',
        'medium',
        expert
      );
    }
    if (ALLOW_CATEGORY_PATTERNS.some((re) => re.test(catText))) {
      return result('guide', 'Category-confirmed', 'category-breadcrumb', 'medium');
    }
  }

  // 5. Kindle-format availability: blank-interior books rarely ship a Kindle
  // edition, so a low share across a decent sample is a low/medium tell.
  if (kindleShare != null && sampleSize >= 4 && kindleShare < 0.15) {
    return result('low-content', 'No Kindle titles (interior / activity style)', 'format-signal', 'low');
  }

  return result('unknown', 'Unknown', 'title-regex', 'low', false);
}