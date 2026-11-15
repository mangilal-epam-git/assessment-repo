/**
 * VectorHarbor solution-design deck, five slides.
 *
 * Palette and motif deliberately match the supervision console, so switching
 * from the slides to the live demo reads as one product rather than two.
 */
const pptxgen = require('pptxgenjs');

const THEME = {
  name: 'VectorHarbor Mobility',
  headFontFace: 'Cambria',
  bodyFontFace: 'Calibri',
  colors: {
    dk1: '16202B', // slate ink
    lt1: 'FFFFFF',
    dk2: '35434F',
    lt2: 'F2F4F5', // cool paper
    accent1: '3D5A80', // machine blue, the dominant structural colour
    accent2: '1F6B4A', // authorised green
    accent3: 'B8730C', // hold amber
    accent4: 'A32A1F', // refused oxide
    accent5: '5A6B7A', // steel
    accent6: '8FA0AD',
    hlink: '3D5A80',
    folHlink: '5A6B7A',
  },
};

const INK = '16202B';
const PAPER = 'F2F4F5';
const STEEL = '5A6B7A';
const RULE = 'C8D0D6';
const BLUE = '3D5A80';
const GREEN = '1F6B4A';
const AMBER = 'B8730C';
const OXIDE = 'A32A1F';
const WHITE = 'FFFFFF';

const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
pres.author = 'Mangi Lal';
pres.company = 'VectorHarbor Mobility';
pres.subject = 'Telematics data marketplace and supervised fleet assistant';
pres.title = 'VectorHarbor solution design';

const C = pres.SchemeColor;

/* ---------------------------------------------------------------- layouts */

pres.defineSlideMaster({
  title: 'DARK_TITLE',
  background: { color: INK },
  objects: [
    {
      placeholder: {
        options: { name: 'title', type: 'title', x: 0.75, y: 1.55, w: 8.6, h: 1.4,
          fontSize: 44, bold: true, color: WHITE, valign: 'bottom', align: 'left' },
        text: '',
      },
    },
    {
      placeholder: {
        options: { name: 'body', type: 'body', x: 0.78, y: 3.1, w: 8.4, h: 1.0,
          fontSize: 16, color: 'B9C4CD', valign: 'top', align: 'left' },
        text: '',
      },
    },
  ],
});

pres.defineSlideMaster({
  title: 'CONTENT',
  background: { color: WHITE },
  objects: [
    {
      placeholder: {
        options: { name: 'title', type: 'title', x: 0.6, y: 0.42, w: 12.1, h: 0.8,
          fontSize: 32, bold: true, color: INK, valign: 'middle', align: 'left' },
        text: '',
      },
    },
    { text: { text: 'VectorHarbor Mobility  |  Solution design',
      options: { x: 0.6, y: 6.95, w: 7.0, h: 0.3, fontSize: 10, color: STEEL, isTextBox: true, margin: 0 } } },
  ],
  slideNumber: { x: 12.5, y: 6.95, w: 0.4, h: 0.3, fontSize: 10, color: STEEL, align: 'right' },
});

pres.defineSlideMaster({
  title: 'DARK_CLOSING',
  background: { color: INK },
  objects: [
    {
      placeholder: {
        options: { name: 'title', type: 'title', x: 0.6, y: 0.45, w: 12.1, h: 0.8,
          fontSize: 32, bold: true, color: WHITE, valign: 'middle', align: 'left' },
        text: '',
      },
    },
  ],
  slideNumber: { x: 12.5, y: 6.95, w: 0.4, h: 0.3, fontSize: 10, color: '8FA0AD', align: 'right' },
});

/* ------------------------------------------------------------- helpers */

/** A labelled box. Fresh options object every call: pptxgenjs mutates them. */
function box(slide, { x, y, w, h, fill, line, radius = 0.06, name }) {
  slide.addShape(pres.ShapeType.roundRect, {
    x, y, w, h, rectRadius: radius,
    fill: fill ? { color: fill } : { type: 'solid', color: WHITE },
    line: { color: line || RULE, width: 1 },
    objectName: name,
  });
}

function label(slide, text, { x, y, w, h, size = 12, color = INK, bold = false, align = 'center', name }) {
  slide.addText(text, {
    x, y, w, h, fontSize: size, color, bold, align, valign: 'middle',
    isTextBox: true, margin: 0, objectName: name,
  });
}

/** The deck's motif: one precise, checkable figure with a quiet label. */
function stat(slide, { x, y, w, value, caption, valueColor, captionColor = '9FB0BC', size = 40 }) {
  slide.addText(value, {
    x, y, w, h: 0.62, fontSize: size, bold: true, color: valueColor,
    align: 'left', valign: 'bottom', isTextBox: true, margin: 0,
    fontFace: 'Cambria', objectName: `stat-${value}`,
  });
  slide.addText(caption, {
    x, y: y + 0.66, w, h: 0.62, fontSize: 11.5, color: captionColor,
    align: 'left', valign: 'top', isTextBox: true, margin: 0,
  });
}

/* -------------------------------------------------------------- slide 1 */

pres.addSection({ title: 'Proposition' });
const s1 = pres.addSlide({ masterName: 'DARK_TITLE', sectionTitle: 'Proposition' });

s1.addText('Prices you can prove', { placeholder: 'title' });
s1.addText(
  'A greenfield telematics data marketplace and a supervised fleet assistant, built so every price can be recomputed and every action can be attributed to a person.',
  { placeholder: 'body' },
);

// The four figures that summarise the proposition.
stat(s1, { x: 0.78, y: 4.45, w: 2.5, value: '100%', caption: 'of prices reproducible\nfrom the audit record', valueColor: WHITE });
stat(s1, { x: 3.48, y: 4.45, w: 2.5, value: '0', caption: 'actions taken without\nhuman approval', valueColor: '6FCF97' });
stat(s1, { x: 6.18, y: 4.45, w: 2.5, value: '302', caption: 'automated tests,\n96.8% line coverage', valueColor: WHITE });
stat(s1, { x: 8.88, y: 4.45, w: 2.5, value: '2', caption: 'clouds, one\nTerraform codebase', valueColor: WHITE });

// A quiet reference to the live artefact, right-aligned away from the title.
s1.addShape(pres.ShapeType.roundRect, {
  x: 9.95, y: 1.6, w: 2.6, h: 2.1, rectRadius: 0.08,
  fill: { color: '1E2A38' }, line: { color: '33455A', width: 1 }, objectName: 'demo-card',
});
s1.addText('Working software', {
  x: 10.2, y: 1.8, w: 2.1, h: 0.3, fontSize: 11, bold: true, color: '8FA0AD', isTextBox: true, margin: 0,
});
s1.addText(
  [
    { text: 'GET /best-offers', options: { breakLine: true, fontSize: 12.5, color: WHITE, fontFace: 'Courier New' } },
    { text: 'Fleet assistant console', options: { breakLine: true, fontSize: 12.5, color: WHITE } },
    { text: 'AWS + Azure IaC', options: { fontSize: 12.5, color: WHITE } },
  ],
  { x: 10.2, y: 2.2, w: 2.2, h: 1.3, isTextBox: true, margin: 0, lineSpacingMultiple: 1.3 },
);

s1.addNotes(
  'Framing: the group has just settled a fraud allegation about data-quality and billing claims. ' +
  'So the product is not "a marketplace with good prices" - it is a marketplace that can prove its prices. ' +
  'That single idea drives the architecture: versioned configuration, exact arithmetic, an append-only audit ledger. ' +
  'Two services are running today; everything else is designed. I will be explicit about which is which.',
);

/* -------------------------------------------------------------- slide 2 */

pres.addSection({ title: 'Architecture' });
const s2 = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Architecture' });
s2.addText('One platform, two things already running', { placeholder: 'title' });

s2.addText(
  'Fleet operators reach a WAF-protected edge; stateless services fan out to certified providers.',
  { x: 0.6, y: 1.18, w: 8.9, h: 0.34, fontSize: 13.5, color: STEEL, isTextBox: true, margin: 0 },
);

// Legend
s2.addShape(pres.ShapeType.roundRect, { x: 9.62, y: 1.14, w: 0.26, h: 0.2, rectRadius: 0.04, fill: { color: BLUE }, line: { color: BLUE, width: 1 } });
label(s2, 'Built', { x: 9.96, y: 1.11, w: 0.8, h: 0.26, size: 10.5, color: INK, align: 'left' });
s2.addShape(pres.ShapeType.roundRect, { x: 10.72, y: 1.14, w: 0.26, h: 0.2, rectRadius: 0.04, fill: { color: WHITE }, line: { color: RULE, width: 1 } });
label(s2, 'Designed', { x: 11.06, y: 1.11, w: 1.6, h: 0.26, size: 10.5, color: STEEL, align: 'left' });

const COLY = 1.78;
const COLH = 0.34;

// Column headers
label(s2, 'Users', { x: 0.6, y: COLY, w: 1.75, h: COLH, size: 11.5, color: STEEL, bold: true, align: 'left' });
label(s2, 'Edge', { x: 2.65, y: COLY, w: 1.9, h: COLH, size: 11.5, color: STEEL, bold: true, align: 'left' });
label(s2, 'Platform services', { x: 4.85, y: COLY, w: 4.6, h: COLH, size: 11.5, color: STEEL, bold: true, align: 'left' });
label(s2, 'Outside our control', { x: 9.75, y: COLY, w: 2.95, h: COLH, size: 11.5, color: STEEL, bold: true, align: 'left' });

// Users
box(s2, { x: 0.6, y: 2.18, w: 1.75, h: 0.72, name: 'users-1' });
label(s2, 'Dispatchers\nMaintenance', { x: 0.6, y: 2.18, w: 1.75, h: 0.72, size: 11 });
box(s2, { x: 0.6, y: 3.0, w: 1.75, h: 0.72, name: 'users-2' });
label(s2, 'Drivers\nProviders', { x: 0.6, y: 3.0, w: 1.75, h: 0.72, size: 11 });
box(s2, { x: 0.6, y: 3.82, w: 1.75, h: 0.62, name: 'users-3' });
label(s2, 'Auditors', { x: 0.6, y: 3.82, w: 1.75, h: 0.62, size: 11 });

// Edge
box(s2, { x: 2.65, y: 2.18, w: 1.9, h: 0.9, fill: PAPER, name: 'edge-waf' });
label(s2, 'CDN + WAF', { x: 2.65, y: 2.3, w: 1.9, h: 0.3, size: 12, bold: true });
label(s2, 'rate limits, DDoS', { x: 2.65, y: 2.62, w: 1.9, h: 0.3, size: 10, color: STEEL });
box(s2, { x: 2.65, y: 3.2, w: 1.9, h: 0.9, fill: PAPER, name: 'edge-gw' });
label(s2, 'API gateway', { x: 2.65, y: 3.32, w: 1.9, h: 0.3, size: 12, bold: true });
label(s2, 'authn, quotas', { x: 2.65, y: 3.64, w: 1.9, h: 0.3, size: 10, color: STEEL });

// Platform services: two built, four designed
const svc = [
  { t: 'Offer ranking', s: 'quality-normalised', built: true, x: 4.85, y: 2.18 },
  { t: 'Fleet assistant', s: 'propose, never act', built: true, x: 7.2, y: 2.18 },
  { t: 'Catalogue', s: 'canonical products', built: false, x: 4.85, y: 3.06 },
  { t: 'Pricing + margin', s: 'versioned approvals', built: false, x: 7.2, y: 3.06 },
  { t: 'Telemetry ingest', s: 'dedupe, ordering', built: false, x: 4.85, y: 3.94 },
  { t: 'Quality + provenance', s: 'spoof detection', built: false, x: 7.2, y: 3.94 },
];
svc.forEach((b, i) => {
  box(s2, { x: b.x, y: b.y, w: 2.25, h: 0.78, fill: b.built ? BLUE : WHITE, line: b.built ? BLUE : RULE, name: `svc-${i}` });
  label(s2, b.t, { x: b.x, y: b.y + 0.1, w: 2.25, h: 0.3, size: 11.5, bold: true, color: b.built ? WHITE : INK });
  label(s2, b.s, { x: b.x, y: b.y + 0.4, w: 2.25, h: 0.28, size: 9.5, color: b.built ? 'CBD8E6' : STEEL });
});

// External
const ext = [
  { t: 'Telemetry providers', y: 2.18 },
  { t: 'Inference model', y: 2.84 },
  { t: 'Payments, FX', y: 3.5 },
  { t: 'Notifications', y: 4.16 },
];
ext.forEach((e, i) => {
  box(s2, { x: 9.75, y: e.y, w: 2.95, h: 0.56, fill: 'FAFBFC', line: RULE, name: `ext-${i}` });
  label(s2, e.t, { x: 9.75, y: e.y, w: 2.95, h: 0.56, size: 11, color: INK });
});

// Cross-cutting band
box(s2, { x: 0.6, y: 4.95, w: 12.1, h: 0.82, fill: '1E2A38', line: '1E2A38', name: 'crosscut' });
label(s2, 'Cross-cutting', { x: 0.85, y: 5.08, w: 1.8, h: 0.28, size: 10.5, color: '8FA0AD', bold: true, align: 'left' });
const cross = ['Append-only audit ledger', 'Consent by purpose', 'Tenant isolation', 'Residency', 'Observability'];
cross.forEach((c, i) => {
  label(s2, c, { x: 2.75 + i * 2.0, y: 5.06, w: 1.95, h: 0.6, size: 11, color: WHITE });
});

s2.addText(
  'AWS recommended for EU regional breadth and S3 Object Lock for WORM audit evidence. Azure kept fully specified and CI-validated, so the choice stays reversible.',
  { x: 0.6, y: 5.98, w: 12.1, h: 0.5, fontSize: 12, color: STEEL, italic: true, isTextBox: true, margin: 0 },
);

s2.addNotes(
  'Left to right: users, edge, services, external systems. The two blue boxes are running code; the outlined ones are designed in the 24-document set. ' +
  'The dark band matters most - audit, consent, tenancy and residency are not features bolted on later, they are properties every service inherits. ' +
  'Cloud recommendation is AWS, and the reasoning is in ADR-0001; Azure is not a slide promise, it is validated Terraform.',
);

/* -------------------------------------------------------------- slide 3 */

pres.addSection({ title: 'Pricing' });
const s3 = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Pricing' });
s3.addText('The cheapest bundle is usually the worse deal', { placeholder: 'title' });

s3.addText(
  'Providers supply different event counts and different verified-quality proportions, so a headline price is not a comparison.',
  { x: 0.6, y: 1.18, w: 12.1, h: 0.34, fontSize: 13.5, color: STEEL, isTextBox: true, margin: 0 },
);

// Two provider cards
const cards = [
  { name: 'telemetry1', price: '12.00 EUR', ev: '100 000', valid: '98 000', cost: '0.134694', win: false, x: 0.6 },
  { name: 'telemetry2', price: '13.00 USD', ev: '120 000', valid: '114 000', cost: '0.115404', win: true, x: 4.6 },
];
cards.forEach((c, i) => {
  box(s3, { x: c.x, y: 1.8, w: 3.75, h: 3.45, fill: c.win ? 'ECF5F0' : WHITE, line: c.win ? GREEN : RULE, name: `card-${i}` });
  label(s3, c.name, { x: c.x + 0.25, y: 2.05, w: 2.2, h: 0.32, size: 14, bold: true, align: 'left' });
  if (c.win) {
    s3.addShape(pres.ShapeType.roundRect, { x: c.x + 2.55, y: 2.06, w: 0.95, h: 0.3, rectRadius: 0.05, fill: { color: GREEN }, line: { color: GREEN, width: 1 } });
    label(s3, 'WINS', { x: c.x + 2.55, y: 2.06, w: 0.95, h: 0.3, size: 9.5, bold: true, color: WHITE });
  }
  const rows = [
    ['Bundle price', c.price],
    ['Events supplied', c.ev],
    ['Verified valid', c.valid],
  ];
  rows.forEach((r, j) => {
    const y = 2.68 + j * 0.44;
    label(s3, r[0], { x: c.x + 0.25, y, w: 1.9, h: 0.34, size: 11.5, color: STEEL, align: 'left' });
    label(s3, r[1], { x: c.x + 2.0, y, w: 1.5, h: 0.34, size: 12, color: INK, align: 'right' });
  });
  s3.addShape(pres.ShapeType.line, { x: c.x + 0.25, y: 4.12, w: 3.25, h: 0, line: { color: c.win ? 'B6D4C4' : RULE, width: 1 } });
  label(s3, 'Cost per 1 000 valid events', { x: c.x + 0.25, y: 4.24, w: 3.25, h: 0.28, size: 10.5, color: STEEL, align: 'left' });
  s3.addText(`${c.cost} EUR`, {
    x: c.x + 0.25, y: 4.5, w: 3.25, h: 0.5, fontSize: 21, bold: true,
    color: c.win ? GREEN : INK, align: 'left', valign: 'middle', isTextBox: true, margin: 0,
    fontFace: 'Courier New',
  });
});

// The verdict
box(s3, { x: 8.75, y: 1.8, w: 3.95, h: 3.45, fill: '1E2A38', line: '1E2A38', name: 'verdict' });
s3.addText('14.3%', {
  x: 9.05, y: 2.1, w: 3.4, h: 0.85, fontSize: 48, bold: true, color: '6FCF97',
  align: 'left', valign: 'middle', isTextBox: true, margin: 0, fontFace: 'Cambria',
});
s3.addText('cheaper on the events a customer can actually use, despite the higher headline price.', {
  x: 9.05, y: 3.02, w: 3.4, h: 0.8, fontSize: 13, color: 'D4DDE4', align: 'left', isTextBox: true, margin: 0,
});
s3.addText(
  [
    { text: 'Exact rational arithmetic, never floating point', options: { bullet: { indent: 14 }, breakLine: true } },
    { text: 'Quality floor of 0.90 blocks cheap, unusable feeds', options: { bullet: { indent: 14 }, breakLine: true } },
    { text: 'Every response names its FX and margin version', options: { bullet: { indent: 14 } } },
  ],
  { x: 9.05, y: 3.95, w: 3.4, h: 1.1, fontSize: 10.5, color: 'B9C4CD', isTextBox: true, margin: 0, valign: 'top', paraSpaceAfter: 4 },
);

s3.addText(
  'Measured: 2.25 microseconds per row. Exactness costs nothing; a price a customer cannot reproduce costs a lawsuit.',
  { x: 0.6, y: 5.52, w: 12.1, h: 0.4, fontSize: 12.5, color: INK, italic: true, isTextBox: true, margin: 0 },
);

s3.addNotes(
  'This is the heart of the coded slice and the easiest thing to get wrong. telemetry1 looks cheaper and, after conversion, is almost identical - ' +
  '12.00 against 11.96 EUR. But telemetry2 delivers 114 000 valid events against 98 000. Per usable event it is 14.3% cheaper. ' +
  'Ranking on bundle price would be exactly the misleading comparison the group settled over. ' +
  'Happy to walk through the arithmetic - every figure is derived by hand in the worked-examples document and asserted in CI.',
);

/* -------------------------------------------------------------- slide 4 */

pres.addSection({ title: 'Supervised AI' });
const s4 = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Supervised AI' });
s4.addText('The assistant proposes. A person decides', { placeholder: 'title' });

s4.addText(
  'Supervision is enforced by architecture, not by prompt instructions. A prompt is a request; an absent capability is a constraint.',
  { x: 0.6, y: 1.18, w: 12.1, h: 0.34, fontSize: 13.5, color: STEEL, isTextBox: true, margin: 0 },
);

const steps = [
  { n: '1', t: 'Propose', d: 'Reads fleet data through allow-listed tools and drafts a work order with its evidence. Commits nothing.', c: BLUE },
  { n: '2', t: 'Approve', d: 'A named human approves specific values, not "the suggestion". Silence expires the proposal.', c: AMBER },
  { n: '3', t: 'Execute', d: 'A single-use token, mintable only by the approval service, carries out the work under that person’s authority.', c: GREEN },
];
steps.forEach((s, i) => {
  const x = 0.6 + i * 4.07;
  box(s4, { x, y: 1.78, w: 3.72, h: 1.95, fill: WHITE, line: RULE, name: `step-${i}` });
  s4.addShape(pres.ShapeType.ellipse, { x: x + 0.25, y: 1.98, w: 0.46, h: 0.46, fill: { color: s.c }, line: { color: s.c, width: 1 } });
  label(s4, s.n, { x: x + 0.25, y: 1.98, w: 0.46, h: 0.46, size: 14, bold: true, color: WHITE });
  label(s4, s.t, { x: x + 0.85, y: 1.98, w: 2.6, h: 0.46, size: 15, bold: true, align: 'left' });
  s4.addText(s.d, { x: x + 0.27, y: 2.56, w: 3.2, h: 1.0, fontSize: 11.5, color: '35434F', isTextBox: true, margin: 0, valign: 'top' });
  if (i < 2) {
    s4.addShape(pres.ShapeType.rightArrow, {
      x: x + 3.79, y: 2.6, w: 0.22, h: 0.3, fill: { color: 'C8D0D6' }, line: { color: 'C8D0D6', width: 1 },
    });
  }
});

// The hard boundary
box(s4, { x: 0.6, y: 3.95, w: 7.79, h: 1.72, fill: 'FBEEEC', line: OXIDE, name: 'boundary' });
label(s4, 'What it cannot do, in any environment', { x: 0.88, y: 4.12, w: 6.0, h: 0.32, size: 13, bold: true, color: OXIDE, align: 'left' });
s4.addText(
  [
    { text: 'Actuate a vehicle — no such tool exists in the codebase', options: { bullet: { indent: 14 }, breakLine: true } },
    { text: 'Approve its own proposal, or spend without a person', options: { bullet: { indent: 14 }, breakLine: true } },
    { text: 'Gain a capability from injected text in fleet records', options: { bullet: { indent: 14 } } },
  ],
  { x: 0.9, y: 4.5, w: 7.2, h: 1.0, fontSize: 11.5, color: '6B2018', isTextBox: true, margin: 0, valign: 'top', paraSpaceAfter: 3 },
);

// Model position
box(s4, { x: 8.75, y: 3.95, w: 3.95, h: 1.72, fill: PAPER, line: RULE, name: 'models' });
label(s4, 'Model is a swappable dependency', { x: 9.0, y: 4.12, w: 3.5, h: 0.32, size: 13, bold: true, align: 'left' });
s4.addText(
  [
    { text: 'Claude, OpenAI, Azure OpenAI or local Llama', options: { bullet: { indent: 14 }, breakLine: true } },
    { text: 'Default planner needs no key and no network', options: { bullet: { indent: 14 }, breakLine: true } },
    { text: 'Safety behaviour identical on every backend', options: { bullet: { indent: 14 } } },
  ],
  { x: 9.02, y: 4.5, w: 3.5, h: 1.0, fontSize: 11.5, color: '35434F', isTextBox: true, margin: 0, valign: 'top', paraSpaceAfter: 3 },
);

s4.addText(
  'Live demo: a technician note instructs the assistant to apply a parking brake and self-approve. It reads it, reports it, and nothing happens.',
  { x: 0.6, y: 5.86, w: 12.1, h: 0.4, fontSize: 12.5, color: INK, italic: true, isTextBox: true, margin: 0 },
);

s4.addNotes(
  'The point to defend: we do not rely on the model behaving. The agent identity can bind read and propose tools only; ' +
  'there is no execute-class tool it can reach, and no vehicle-actuation capability anywhere in the codebase in any environment. ' +
  'Even a fully prompt-injected model produces, at worst, a proposal a human declines. ' +
  'The console shows a live, hash-chained ledger and a count of actions taken without approval, computed on every refresh. It reads zero.',
);

/* -------------------------------------------------------------- slide 5 */

pres.addSection({ title: 'Delivery' });
const s5 = pres.addSlide({ masterName: 'DARK_CLOSING', sectionTitle: 'Delivery' });
s5.addText('What is built, what is next', { placeholder: 'title' });

// Built / designed columns
box(s5, { x: 0.6, y: 1.45, w: 5.9, h: 2.32, fill: '1E2A38', line: '33455A', name: 'built' });
label(s5, 'Running today', { x: 0.88, y: 1.62, w: 3.0, h: 0.32, size: 13, bold: true, color: '6FCF97', align: 'left' });
s5.addText(
  [
    { text: 'Offer normalisation and ranking, with mock providers', options: { bullet: { indent: 14 }, breakLine: true } },
    { text: 'Supervised assistant, approval gate and audit ledger', options: { bullet: { indent: 14 }, breakLine: true } },
    { text: 'Terraform for AWS and Azure, CI/CD, scanning', options: { bullet: { indent: 14 }, breakLine: true } },
    { text: '302 tests, thresholds enforced in the build', options: { bullet: { indent: 14 } } },
  ],
  { x: 0.9, y: 2.05, w: 5.3, h: 2.0, fontSize: 12.5, color: 'E3E9ED', isTextBox: true, margin: 0, valign: 'top', paraSpaceAfter: 6 },
);

box(s5, { x: 6.8, y: 1.45, w: 5.9, h: 2.32, fill: '1E2A38', line: '33455A', name: 'designed' });
label(s5, 'Designed, not built', { x: 7.08, y: 1.62, w: 3.4, h: 0.32, size: 13, bold: true, color: 'E0A33E', align: 'left' });
s5.addText(
  [
    { text: 'Telemetry ingestion, quality verification, spoof detection', options: { bullet: { indent: 14 }, breakLine: true } },
    { text: 'Consent service, merger REST API, notifications', options: { bullet: { indent: 14 }, breakLine: true } },
    { text: 'Payments orchestration and local-currency checkout', options: { bullet: { indent: 14 }, breakLine: true } },
    { text: 'Customer-facing web application', options: { bullet: { indent: 14 } } },
  ],
  { x: 7.1, y: 2.05, w: 5.3, h: 2.0, fontSize: 12.5, color: 'E3E9ED', isTextBox: true, margin: 0, valign: 'top', paraSpaceAfter: 6 },
);

// Rollout
label(s5, 'Phased rollout, each gate measured before the next begins', { x: 0.6, y: 4.12, w: 8.0, h: 0.3, size: 12.5, bold: true, color: '8FA0AD', align: 'left' });
const phases = [
  { t: 'Pilot', d: '20 fleets, one jurisdiction' },
  { t: 'Supervised agent', d: 'zero unapproved actions' },
  { t: 'Scale out', d: 'regions, provider cohorts' },
  { t: 'M&A at pace', d: 'certified in under 30 days' },
];
phases.forEach((p, i) => {
  const x = 0.6 + i * 3.08;
  box(s5, { x, y: 4.5, w: 2.86, h: 0.92, fill: '22303F', line: '33455A', name: `phase-${i}` });
  label(s5, p.t, { x: x + 0.18, y: 4.62, w: 2.5, h: 0.3, size: 12, bold: true, color: WHITE, align: 'left' });
  label(s5, p.d, { x: x + 0.18, y: 4.9, w: 2.5, h: 0.4, size: 10.5, color: '9FB0BC', align: 'left' });
});

s5.addText(
  [
    { text: 'Next: ', options: { bold: true, color: WHITE } },
    { text: 'agree the launch cohort and jurisdiction, confirm the model backend and its data terms, and run the first provider through adapter certification.', options: { color: 'B9C4CD' } },
  ],
  { x: 0.6, y: 5.78, w: 12.1, h: 0.5, fontSize: 13, isTextBox: true, margin: 0 },
);

s5.addNotes(
  'Being explicit about the split is deliberate - the brief asks for unimplemented requirements to be identified honestly, and the traceability matrix maps all 17 functional and 16 non-functional requirements to design, code and evidence. ' +
  'Cost: production is about 1 030 USD a month for the marketplace, and inference roughly doubles it, which makes model choice a budget decision as much as a quality one. ' +
  'Three asks to close on: launch cohort, model backend and its data-processing terms, and the first certification candidate.',
);

/* ------------------------------------------------------------------ write */

(async () => {
  await pres.writeFile({ fileName: 'VectorHarbor-solution-design.pptx' });
  // pptxgenjs cannot write theme colours, so they are patched in afterwards.
  // Without this the scheme colours fall back to Office's stock palette.
  try {
    const { applyTheme } = require(process.env.PPTX_THEME_HELPER
      || '/sessions/intelligent-cool-sagan/mnt/.claude/skills/pptx/scripts/apply_theme.js');
    await applyTheme('VectorHarbor-solution-design.pptx', THEME);
  } catch {
    process.stdout.write('Theme helper unavailable; deck written with default theme colours.\n');
  }
  process.stdout.write('VectorHarbor-solution-design.pptx written\n');
})();
