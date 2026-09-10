/**
 * Curated list of Amazon Books browse-node IDs used for the seedless
 * "Discovery Mode" (Best Sellers / Movers & Shakers / New Releases).
 *
 * These are hand-curated starting points — Amazon's category tree shifts over
 * time, and the discovery fetcher is written to skip any node that stops
 * resolving. Extend / prune this list as you learn which nodes produce the
 * best niche candidates for your publishing focus (baby/mom-adjacent,
 * low-content journals/planners, compiled guides & niche nonfiction).
 *
 * `kdpFriendly: false` marks fiction and expertise-required nodes (novels,
 * romance/fantasy/mystery genres, biography, clinical/technical/academic,
 * law, exam prep). The default discovery pick skips them so "Discover Niches"
 * only surfaces books an indie can actually produce. Nodes reachable through
 * the settings' explicit category-picker still work as an opt-in escape hatch.
 *
 * Structure: { id: browseNodeId, name: human label, tier: 'top'|'niche',
 *              kdpFriendly?: boolean }
 */
export const DISCOVERY_CATEGORIES = [
  // --- Top-level Books nodes (stable, broad) ---
  { id: '283155', name: 'Books (All)', tier: 'top' },
  { id: '1008000', name: 'Baby & Toddler', tier: 'top' },
  { id: '4', name: "Children's Books", tier: 'top' },
  { id: '3', name: 'Business & Money', tier: 'top' },
  { id: '12290', name: 'Christian Books & Bibles', tier: 'top' },
  { id: '6', name: 'Cookbooks, Food & Wine', tier: 'top' },
  { id: '48', name: 'Crafts, Hobbies & Home', tier: 'top' },
  { id: '5269823011', name: 'Education & Reference', tier: 'top' },
  { id: '10', name: 'Health, Fitness & Dieting', tier: 'top' },
  { id: '86', name: 'Humor & Entertainment', tier: 'top' },
  { id: '53', name: 'Nonfiction', tier: 'top' },
  { id: '20', name: 'Parenting & Relationships', tier: 'top' },
  { id: '21', name: 'Reference', tier: 'top' },
  { id: '22', name: 'Religion & Spirituality', tier: 'top' },
  { id: '4736', name: 'Self-Help', tier: 'top' },
  { id: '26', name: 'Sports & Outdoors', tier: 'top' },
  { id: '27', name: 'Travel', tier: 'top' },
  { id: '1', name: 'Arts & Photography', tier: 'top', kdpFriendly: false },
  { id: '2', name: 'Biographies & Memoirs', tier: 'top', kdpFriendly: false },
  { id: '4366', name: 'Comics & Graphic Novels', tier: 'top', kdpFriendly: false },
  { id: '4367', name: 'Manga', tier: 'top', kdpFriendly: false },
  { id: '5', name: 'Computers & Technology', tier: 'top', kdpFriendly: false },
  { id: '173507', name: 'Engineering & Transportation', tier: 'top', kdpFriendly: false },
  { id: '9', name: 'History', tier: 'top', kdpFriendly: false },
  { id: '10777', name: 'Law', tier: 'top', kdpFriendly: false },
  { id: '17', name: 'Literature & Fiction', tier: 'top', kdpFriendly: false },
  { id: '23', name: 'Romance', tier: 'top', kdpFriendly: false },
  { id: '25', name: 'Science Fiction & Fantasy', tier: 'top', kdpFriendly: false },
  { id: '28', name: 'Teen & Young Adult', tier: 'top', kdpFriendly: false },
  { id: '5267710011', name: 'Test Preparation', tier: 'top', kdpFriendly: false },
  { id: '11713', name: 'True Crime', tier: 'top', kdpFriendly: false },

  // --- Children's / low-content (KDP sweet spot) ---
  { id: '2665', name: 'Children\'s Activity Books', tier: 'niche' },
  { id: '2851', name: 'Children\'s Coloring Books', tier: 'niche' },
  { id: '2978', name: "Children's Growing Up & Facts of Life", tier: 'niche' },
  { id: '3003', name: "Children's Animals", tier: 'niche' },
  { id: '3005', name: "Children's Bedtime & Dreaming", tier: 'niche' },
  { id: '3007', name: "Children's Basic Concepts", tier: 'niche' },
  { id: '6132', name: "Children's Education & Reference", tier: 'niche' },
  { id: '3299', name: "Children's Holidays & Celebrations", tier: 'niche' },
  { id: '3307', name: "Children's Humor", tier: 'niche' },
  { id: '2062', name: "Children's Crafts", tier: 'niche' },
  { id: '2072', name: 'Children\'s Games', tier: 'niche' },

  // --- Rules v1 (rule 8): "Not Generally Low-Content" families ---
  { id: '2020', name: 'Photography', tier: 'niche' },
  { id: '5211', name: 'Puzzles', tier: 'niche' },
  { id: '5210', name: 'Board Games', tier: 'niche' },
  { id: '5207', name: 'Hobbies, Games & Puzzles (Top)', tier: 'top' },
  { id: '227137', name: 'Music', tier: 'niche' },
  { id: '11015', name: 'Songbooks, Musicals & Songwriting', tier: 'niche' },
  { id: '4653', name: 'Children\'s Composition Creative Writing (Textbook)', tier: 'niche' },
  { id: '10605', name: 'School & Education Textbooks', tier: 'niche' },
  { id: '468226', name: 'How-to & Home Improvements (Manuals)', tier: 'niche' },
  { id: '4718', name: 'Do-It-Yourself (Manuals)', tier: 'niche' },
  { id: '536180', name: 'Children\'s Game Books', tier: 'niche' },
  { id: '4', name: "Children's Books (Top, rule8)", tier: 'top' },

  // --- Journals, planners & notebooks (low-content) ---
  { id: '134564', name: 'Journals & Notebooks', tier: 'niche' },
  { id: '134561', name: 'Planners & Personal Organizers', tier: 'niche' },
  { id: '134563', name: 'Diaries', tier: 'niche' },
  { id: '134562', name: 'Calendars', tier: 'niche' },

  // --- Health, fitness & diet sub-niches ---
  { id: '4775', name: 'Diets & Weight Loss', tier: 'niche' },
  { id: '4078', name: 'Exercise & Fitness', tier: 'niche' },
  { id: '1007969001', name: 'Low Carbohydrate Diet', tier: 'niche' },
  { id: '4867', name: 'Healthy Cooking', tier: 'niche' },
  { id: '4663', name: 'Mental Health', tier: 'niche' },
  { id: '4672', name: 'Anxiety', tier: 'niche' },
  { id: '11120', name: 'Depression', tier: 'niche' },
  { id: '4510', name: 'Beauty, Grooming & Style', tier: 'niche' },
  { id: '4484', name: 'Alternative Medicine', tier: 'niche' },
  { id: '11113', name: 'Herbal Remedies', tier: 'niche' },
  { id: '227579', name: 'Nutrition', tier: 'niche' },
  { id: '2829', name: 'Sleep & Dreams', tier: 'niche' },

  // --- Self-help sub-niches ---
  { id: '468228', name: 'Success', tier: 'niche' },
  { id: '4739', name: 'Motivational', tier: 'niche' },
  { id: '4738', name: 'Creativity', tier: 'niche' },
  { id: '4734', name: 'Stress Management', tier: 'niche' },
  { id: '4740', name: 'Happiness', tier: 'niche' },
  { id: '4731', name: 'Anger Management', tier: 'niche' },
  { id: '4735', name: 'Personal Transformation', tier: 'niche' },
  { id: '4742', name: 'Time Management', tier: 'niche' },

  // --- Parenting & relationships sub-niches ---
  { id: '172777', name: 'Family Relationships', tier: 'niche' },
  { id: '3326', name: 'Babies', tier: 'niche' },
  { id: '3333', name: 'Health & Nutrition for Babies', tier: 'niche' },
  { id: '3295', name: 'Child Care', tier: 'niche' },
  { id: '1679', name: 'Parenting Girls', tier: 'niche' },
  { id: '3011', name: 'Parenting Boys', tier: 'niche' },
  { id: '4490', name: 'Pregnancy & Childbirth', tier: 'niche' },
  { id: '4496', name: 'Prenatal Care', tier: 'niche' },
  { id: '5656', name: 'Breastfeeding', tier: 'niche' },
  { id: '4887', name: 'Baby Food & Feeding', tier: 'niche' },

  // --- Cookbooks & food sub-niches ---
  { id: '4660', name: 'Quick & Easy Cooking', tier: 'niche' },
  { id: '4686', name: 'Special Diet Cooking', tier: 'niche' },
  { id: '4688', name: 'Vegan Cooking', tier: 'niche' },
  { id: '2970', name: 'Vegetarian Cooking', tier: 'niche' },
  { id: '4661', name: 'Baking', tier: 'niche' },
  { id: '4679', name: 'Cakes', tier: 'niche' },
  { id: '4673', name: 'Canning & Preserving', tier: 'niche' },
  { id: '4670', name: 'Cooking for One', tier: 'niche' },
  { id: '2334', name: 'Cooking for Kids', tier: 'niche' },
  { id: '4674', name: 'Slow Cooker Recipes', tier: 'niche' },
  { id: '4712', name: 'Air Fryer Recipes', tier: 'niche' },

  // --- Crafts & hobbies sub-niches ---
  { id: '1287', name: 'Knitting', tier: 'niche' },
  { id: '1280', name: 'Needlepoint & Embroidery', tier: 'niche' },
  { id: '4089', name: 'Paper Crafts', tier: 'niche' },
  { id: '3382', name: 'Scrapbooking', tier: 'niche' },
  { id: '1294', name: 'Quilting', tier: 'niche' },
  { id: '1283', name: 'Sewing', tier: 'niche' },
  { id: '2999', name: 'Quilts & Quilting', tier: 'niche' },

  // --- Genre fiction sub-niches (kdpFriendly: false — fiction writing) ---
  { id: '4722', name: 'Romance: Contemporary', tier: 'niche', kdpFriendly: false },
  { id: '4723', name: 'Romance: Historical', tier: 'niche', kdpFriendly: false },
  { id: '4730', name: 'Romance: Paranormal', tier: 'niche', kdpFriendly: false },
  { id: '4725', name: 'Romance: Fantasy', tier: 'niche', kdpFriendly: false },
  { id: '4724', name: 'Romance: Western', tier: 'niche', kdpFriendly: false },
  { id: '4726', name: 'Romance: Suspense', tier: 'niche', kdpFriendly: false },
  { id: '4729', name: 'Romance: Vampires', tier: 'niche', kdpFriendly: false },
  { id: '4728', name: 'Romance: American', tier: 'niche', kdpFriendly: false },
  { id: '16190', name: 'Fantasy', tier: 'niche', kdpFriendly: false },
  { id: '16260301', name: 'Gaslamp Fantasy', tier: 'niche', kdpFriendly: false },
  { id: '16197', name: 'Epic Fantasy', tier: 'niche', kdpFriendly: false },
  { id: '8353', name: 'Dark Fantasy', tier: 'niche', kdpFriendly: false },
  { id: '158124011', name: 'Science Fiction', tier: 'niche', kdpFriendly: false },
  { id: '16192', name: 'Space Opera', tier: 'niche', kdpFriendly: false },
  { id: '1045842', name: 'Post-Apocalyptic', tier: 'niche', kdpFriendly: false },
  { id: '16244011', name: 'Cyberpunk', tier: 'niche', kdpFriendly: false },
  { id: '2070', name: 'Mystery & Thrillers', tier: 'niche', kdpFriendly: false },
  { id: '10831', name: 'Cozy Mysteries', tier: 'niche', kdpFriendly: false },
  { id: '1099', name: 'Women Sleuths', tier: 'niche', kdpFriendly: false },
  { id: '80018', name: 'Amateur Sleuth', tier: 'niche', kdpFriendly: false },
  { id: '49', name: 'Thrillers & Suspense', tier: 'niche', kdpFriendly: false },
  { id: '5734', name: 'Psychological Thrillers', tier: 'niche', kdpFriendly: false },
  { id: '8789', name: 'Technothrillers', tier: 'niche', kdpFriendly: false },
  { id: '16022', name: 'Horror', tier: 'niche', kdpFriendly: false },
  { id: '11144', name: 'Ghosts', tier: 'niche', kdpFriendly: false },
  { id: '16109', name: 'Occult', tier: 'niche', kdpFriendly: false },
  { id: '11488', name: 'Westerns', tier: 'niche', kdpFriendly: false },
  { id: '4401', name: 'Christian Fiction', tier: 'niche', kdpFriendly: false },

  // --- Business & money sub-niches ---
  { id: '2717', name: 'Marketing & Sales', tier: 'niche' },
  { id: '2710', name: 'Starting a Business', tier: 'niche' },
  { id: '2529', name: 'E-commerce', tier: 'niche' },
  { id: '4698', name: 'Personal Finance', tier: 'niche' },
  { id: '4684', name: 'Budgeting & Money Management', tier: 'niche' },
  { id: '4662', name: 'Women & Business', tier: 'niche' },
  { id: '7551', name: 'Entrepreneurship', tier: 'niche' },
  { id: '2645', name: 'Small Business', tier: 'niche' },

  // --- Education & reference sub-niches ---
  { id: '5267723011', name: 'Study Guides', tier: 'niche' },
  { id: '8975355011', name: 'Notebooks', tier: 'niche' },
  { id: '8975360011', name: 'Planners & Organizers (Study)', tier: 'niche' },
  { id: '11808', name: 'Writing & Publishing', tier: 'niche' },
  { id: '1064', name: 'Writing Skills', tier: 'niche' },
  { id: '11017', name: 'Publishing & Books', tier: 'niche' },
  { id: '11414', name: 'Homework Help', tier: 'niche' },

  // --- Travel / outdoors sub-niches ---
  { id: '14735', name: 'Budget Travel', tier: 'niche' },
  { id: '14736', name: 'Family Travel', tier: 'niche' },
  { id: '14744', name: 'Road Travel', tier: 'niche' },
  { id: '14752', name: 'Hiking & Camping', tier: 'niche' },
  { id: '14750', name: 'Camping', tier: 'niche' },
  { id: '2168', name: 'Travel Writing', tier: 'niche' },

  // --- True crime / history sub-niches (kdpFriendly: false — narrative long-form) ---
  { id: '3004', name: 'Serial Killers', tier: 'niche', kdpFriendly: false },
  { id: '3010', name: 'Criminology', tier: 'niche', kdpFriendly: false },
  { id: '3050', name: 'World War II History', tier: 'niche', kdpFriendly: false },
  { id: '4853', name: 'Native American History', tier: 'niche', kdpFriendly: false },
  { id: '4873', name: 'Women in History', tier: 'niche', kdpFriendly: false },
  { id: '4855', name: 'Military History', tier: 'niche', kdpFriendly: false }
];

export function getDiscoveryCategories() {
  return DISCOVERY_CATEGORIES.slice();
}

export function discoveryCategoryById(id) {
  return DISCOVERY_CATEGORIES.find((c) => String(c.id) === String(id)) || null;
}

/**
 * Rule 8 (v0.8): default discovery order — Low-Content families FIRST, then
 * the "Not Generally Low-Content" families (puzzle, coloring, photography,
 * sheet music, manuals, textbooks, children's), then everything else. The
 * auto-discover run walks this order, so the first keywords it surfaces are
 * always blank-interior / activity niches an indie can actually produce.
 */
export const RULE8_PRIORITY_NODE_IDS = [
  // Low-Content first: journals, planners, notebooks, diaries, logs/trackers
  '134564', '134561', '134563', '134562', '8975355011', '8975360011',
  // Not Generally Low-Content: puzzles, games, coloring, activity
  '5211', '5210', '536180', '2851', '2665', '2072', '2062',
  // Crafting templates / scrapbook
  '4089', '3382',
  // Photography / sheet music / manuals / textbooks / children's
  '2020', '227137', '11015', '468226', '4718', '4653', '10605', '4',
  '6132', '3003', '3005', '3007', '3299', '3307'
];

export function pickDiscoveryNodes(ids) {
  if (Array.isArray(ids) && ids.length) {
    // Explicit selection = opt-in escape hatch; honor it verbatim.
    const byId = new Map(DISCOVERY_CATEGORIES.map((c) => [String(c.id), c]));
    return ids
      .map((id) => byId.get(String(id)))
      .filter(Boolean);
  }
  // Default pick: only KDP-publishable nodes (fiction/expertise excluded),
  // ordered Low-Content first per RULE8_PRIORITY_NODE_IDS (rule 8).
  const eligible = DISCOVERY_CATEGORIES.filter((c) => c.kdpFriendly !== false);
  const rank = new Map(RULE8_PRIORITY_NODE_IDS.map((id, i) => [String(id), i]));
  const niche = eligible.filter((c) => c.tier === 'niche').sort((a, b) =>
    (rank.has(String(a.id)) ? rank.get(String(a.id)) : 1e6) -
    (rank.has(String(b.id)) ? rank.get(String(b.id)) : 1e6)
  );
  const top = eligible.filter((c) => c.tier === 'top');
  return niche.concat(top);
}