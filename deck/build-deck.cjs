// Builds deck/Regulars-BLAZE-2026.pptx: the BLAZE "Widget Factory" structure (7 slides) in a dark
// protocol style. Run: NODE_PATH=<dir with pptxgenjs> node deck/build-deck.cjs <path to apply_theme.js>
const path = require('node:path');
const pptxgen = require('pptxgenjs');
const { applyTheme } = require(process.argv[2]);

const OUT = path.join(__dirname, 'Regulars-BLAZE-2026.pptx');
const URL_APP = 'regulars-bch.vercel.app';
const URL_REPO = 'github.com/codeswithroh/regulars';

const THEME = {
  name: 'Regulars Protocol',
  headFontFace: 'Arial',
  bodyFontFace: 'Calibri',
  colors: {
    dk1: '0B0D0C', // background
    lt1: 'F2F5F3', // primary text
    dk2: '151A17', // card surface
    lt2: '8E9893', // muted text
    accent1: '3ECF8E', // green: the one accent
    accent2: '2A3330', // card border
    accent3: 'C7F2DC', // pale green for code strings
    accent4: '5B6661',
    accent5: '1F2723',
    accent6: 'E8C26B',
    hlink: '3ECF8E',
    folHlink: '3ECF8E',
  },
};
const HEX = THEME.colors;
const MONO = 'Courier New';

const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE'; // 13.333" x 7.5"
pres.title = 'Regulars: BCH BLAZE 2026';
pres.author = 'codeswithroh';
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
const C = pres.SchemeColor;
const W = 13.333;
const M = 0.6; // outer margin

// ---------- layouts ----------
pres.defineSlideMaster({
  title: 'TITLE_DARK',
  background: { color: C.text1 },
  objects: [
    { placeholder: { options: { name: 'title', type: 'title', x: M, y: 2.35, w: 6.6, h: 1.5, fontSize: 72, bold: true, color: C.background1, valign: 'top', align: 'left', margin: 0 }, text: '' } },
  ],
});
pres.defineSlideMaster({
  title: 'CONTENT_DARK',
  background: { color: C.text1 },
  objects: [
    { placeholder: { options: { name: 'title', type: 'title', x: M, y: 0.95, w: W - 2 * M, h: 1.35, fontSize: 34, bold: true, color: C.background1, valign: 'top', align: 'left', margin: 0 }, text: '' } },
    { text: { text: URL_APP, options: { x: M, y: 6.95, w: 5, h: 0.3, fontFace: MONO, fontSize: 10, color: C.background2, margin: 0 } } },
  ],
  slideNumber: { x: W - M - 1, y: 6.95, w: 1, h: 0.3, fontFace: MONO, fontSize: 10, color: C.background2, align: 'right' },
});

// ---------- helpers ----------
let shapeCount = 0;
const id = (name) => `${name}-${++shapeCount}`;

/** Monospace section label, e.g. "// 02  what it is". */
function label(slide, text, y = 0.55) {
  slide.addText(text, { x: M, y, w: 8, h: 0.3, fontFace: MONO, fontSize: 12, color: C.accent1, margin: 0, isTextBox: true, objectName: id('label') });
}

function card(slide, x, y, w, h, fill = C.text2) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.12, fill: { color: fill }, line: { color: C.accent2, width: 1 }, objectName: id('card') });
}

/** A code card: lines are [text, kind] where kind is 'kw' | 'req' | 'cmt' | 'plain'. */
function codeCard(slide, x, y, w, h, title, lines, size = 13) {
  card(slide, x, y, w, h);
  slide.addText(title, { x: x + 0.3, y: y + 0.22, w: w - 0.6, h: 0.3, fontFace: MONO, fontSize: 11, color: C.background2, margin: 0, isTextBox: true, objectName: id('code-title') });
  const colors = { kw: C.accent1, req: C.background1, cmt: C.background2, plain: C.accent3 };
  const runs = lines.map(([text, kind], i) => ({ text, options: { color: colors[kind], breakLine: i < lines.length - 1 } }));
  slide.addText(runs, { x: x + 0.3, y: y + 0.62, w: w - 0.6, h: h - 0.85, fontFace: MONO, fontSize: size, valign: 'top', margin: 0, paraSpaceAfter: 4, isTextBox: true, objectName: id('code') });
}

function stat(slide, x, y, w, big, small, bigColor = C.accent1, bigSize = 54) {
  slide.addText(big, { x, y, w, h: 0.95, fontFace: THEME.headFontFace, fontSize: bigSize, bold: true, color: bigColor, margin: 0, valign: 'bottom', isTextBox: true, objectName: id('stat') });
  slide.addText(small, { x, y: y + 1.0, w, h: 0.6, fontSize: 14, color: C.background2, margin: 0, valign: 'top', isTextBox: true, objectName: id('stat-label') });
}

function arrow(slide, x1, y, x2) {
  slide.addShape(pres.shapes.LINE, { x: x1, y, w: x2 - x1, h: 0, line: { color: C.accent1, width: 2, endArrowType: 'triangle' }, objectName: id('arrow') });
}

const notes = (slide, text) => slide.addNotes(text);

// ---------- 1. title ----------
pres.addSection({ title: 'Regulars' });
{
  const s = pres.addSlide({ masterName: 'TITLE_DARK', sectionTitle: 'Regulars' });
  s.addText('// BCH BLAZE 2026 · Mainnet track', { x: M, y: 1.75, w: 6.6, h: 0.35, fontFace: MONO, fontSize: 14, color: C.accent1, margin: 0, isTextBox: true, objectName: 'event' });
  s.addText('Regulars', { placeholder: 'title' });
  s.addText('Loyalty points that are real money.', { x: M, y: 3.75, w: 6.6, h: 0.6, fontSize: 26, color: C.background1, margin: 0, isTextBox: true, objectName: 'tagline' });
  s.addText('A loyalty protocol on Bitcoin Cash with no backend.', { x: M, y: 4.35, w: 6.6, h: 0.45, fontSize: 18, color: C.background2, margin: 0, isTextBox: true, objectName: 'subtitle' });
  s.addText([
    { text: URL_APP, options: { hyperlink: { url: `https://${URL_APP}` }, color: C.accent1, breakLine: true } },
    { text: URL_REPO, options: { hyperlink: { url: `https://${URL_REPO}` }, color: C.accent1, breakLine: true } },
    { text: 'Built by codeswithroh', options: { color: C.background2 } },
  ], { x: M, y: 5.45, w: 6.6, h: 1.1, fontFace: MONO, fontSize: 14, margin: 0, valign: 'top', paraSpaceAfter: 4, isTextBox: true, objectName: 'links' });
  codeCard(s, 7.75, 1.75, 5.0, 3.6, 'StampIssuer.cash · earn()', [
    ['function earn() {', 'kw'],
    ['  require(output 0 is this issuer);', 'req'],
    ['  require(stampsOut > 0);', 'req'],
    ['  require(fee stays in issuer);', 'req'],
    ['  require(output 1 pays the shop);', 'req'],
    ['}', 'kw'],
    ['// payment and reward:', 'cmt'],
    ['// one transaction, inseparable', 'cmt'],
  ], 14);
  s.addText([
    { text: '2', options: { color: C.accent1, bold: true } },
    { text: ' contracts   ', options: { color: C.background2 } },
    { text: '0', options: { color: C.accent1, bold: true } },
    { text: ' servers', options: { color: C.background2 } },
  ], { x: 7.75, y: 5.6, w: 5.0, h: 0.5, fontFace: MONO, fontSize: 18, margin: 0, isTextBox: true, objectName: 'twozero' });
  notes(s, 'Regulars: loyalty points that are real money. A loyalty protocol on Bitcoin Cash with no backend: two contracts and a static web page. Live on mainnet at regulars-bch.vercel.app.');
}

// ---------- 2. what it is ----------
pres.addSection({ title: 'What it is' });
{
  const s = pres.addSlide({ masterName: 'CONTENT_DARK', sectionTitle: 'What it is' });
  label(s, '// 02  what it is');
  s.addText('Pay a shop. Your reward arrives in the same transaction', { placeholder: 'title' });
  s.addText('Any shop opens a loyalty programme with one transaction from its own wallet. Customers earn stamps the instant they pay, and redeem them for BCH from a reserve the shop locked up front.', {
    x: M, y: 2.5, w: 7.4, h: 1.0, fontSize: 16, color: C.background2, margin: 0, valign: 'top', isTextBox: true, objectName: 'body',
  });
  // Flow: wallet -> one transaction -> shop + stamps
  const y = 3.95;
  card(s, M, y, 3.1, 1.75);
  s.addText([{ text: 'Customer wallet', options: { bold: true, color: C.background1, breakLine: true } }, { text: 'signs once over WizardConnect', options: { color: C.background2, fontSize: 13 } }],
    { x: M + 0.3, y: y + 0.3, w: 2.5, h: 1.2, fontSize: 18, margin: 0, valign: 'top', isTextBox: true, objectName: 'flow-wallet' });
  arrow(s, M + 3.2, y + 0.88, M + 4.4);
  card(s, M + 4.5, y, 3.3, 1.75, C.accent5);
  s.addText([{ text: 'One transaction', options: { bold: true, color: C.accent1, breakLine: true } }, { text: 'StampIssuer covenant checks the payment', options: { color: C.background2, fontSize: 13 } }],
    { x: M + 4.8, y: y + 0.3, w: 2.8, h: 1.2, fontSize: 18, margin: 0, valign: 'top', isTextBox: true, objectName: 'flow-tx' });
  arrow(s, M + 7.9, y + 0.5, M + 9.1);
  arrow(s, M + 7.9, y + 1.25, M + 9.1);
  card(s, M + 9.2, y - 0.25, 2.9, 0.95);
  s.addText([{ text: 'Shop paid', options: { bold: true, color: C.background1, breakLine: true } }, { text: 'straight to its wallet', options: { color: C.background2, fontSize: 12 } }],
    { x: M + 9.45, y: y - 0.12, w: 2.5, h: 0.75, fontSize: 16, margin: 0, valign: 'top', isTextBox: true, objectName: 'flow-shop' });
  card(s, M + 9.2, y + 0.95, 2.9, 0.95);
  s.addText([{ text: 'Stamps received', options: { bold: true, color: C.background1, breakLine: true } }, { text: 'a CashToken in the payer’s wallet', options: { color: C.background2, fontSize: 12 } }],
    { x: M + 9.45, y: y + 1.08, w: 2.5, h: 0.75, fontSize: 16, margin: 0, valign: 'top', isTextBox: true, objectName: 'flow-stamps' });
  s.addText([
    { text: 'No server, no database, no keys held by anyone but the shop and its customers.  ', options: { color: C.background1 } },
    { text: URL_REPO, options: { color: C.accent1, hyperlink: { url: `https://${URL_REPO}` } } },
  ], { x: M, y: 6.3, w: W - 2 * M, h: 0.4, fontSize: 14, margin: 0, isTextBox: true, objectName: 'footline' });
  notes(s, 'The stamps sit in a covenant that releases them only in a transaction that also pays the shop. So paying and earning are one atomic transaction.');
}

// ---------- 3. story ----------
pres.addSection({ title: 'The story' });
{
  const s = pres.addSlide({ masterName: 'CONTENT_DARK', sectionTitle: 'The story' });
  label(s, '// 03  the story');
  s.addText('Card networks take about 3%. BCH takes a fraction of a cent', { placeholder: 'title' });
  card(s, M, 2.55, 2.85, 2.15);
  stat(s, M + 0.3, 2.7, 2.4, '~3%', 'card fees on every sale', C.background1);
  card(s, M + 3.15, 2.55, 2.85, 2.15, C.accent5);
  stat(s, M + 3.45, 2.7, 2.4, '<1¢', 'Bitcoin Cash network fee');
  s.addText([
    { text: 'A shop that accepts BCH keeps that 3%, but its customers have no reason to care. ', options: { breakLine: true } },
    { text: 'Regulars hands the saving to the customer as cashback: a reason to choose BCH at the till, and a reason to come back.', options: { breakLine: true } },
    { text: 'Ordinary loyalty points are a promise the shop can change or cancel. Here the reward money is locked on-chain before the first stamp is issued.', options: { color: C.background1 } },
  ], { x: M + 6.5, y: 2.55, w: W - 2 * M - 6.5, h: 3.9, fontSize: 16, color: C.background2, margin: 0, valign: 'top', paraSpaceAfter: 14, isTextBox: true, objectName: 'story' });
  s.addText('// funded by fees the shop no longer pays to cards', { x: M, y: 5.0, w: 6.0, h: 0.6, fontFace: MONO, fontSize: 12, color: C.accent1, margin: 0, valign: 'top', isTextBox: true, objectName: 'story-note' });
  notes(s, 'Why it matters: BCH merchants save around 3% versus cards. Regulars turns that saving into cashback customers can trust, because the reward money is locked in a contract.');
}

// ---------- 4. benefits ----------
pres.addSection({ title: 'Benefits' });
{
  const s = pres.addSlide({ masterName: 'CONTENT_DARK', sectionTitle: 'Benefits' });
  label(s, '// 04  benefits');
  s.addText('Good for the customer, the shop and the chain', { placeholder: 'title' });
  const cols = [
    ['customers', 'Customers', 'Stamps land in their own wallet with the payment itself. Redeem them, send them to a friend, or trade them.'],
    ['shops', 'Shops', 'Open in about a minute. No hardware, no app, no sign-up, no customer database. Payments go straight to the shop’s wallet.'],
    ['bch', 'Bitcoin Cash', 'Every reward is a reason to pay in BCH again, from any wallet that speaks WizardConnect.'],
  ];
  const cw = (W - 2 * M - 2 * 0.35) / 3;
  cols.forEach(([key, head, body], i) => {
    const x = M + i * (cw + 0.35);
    card(s, x, 2.5, cw, 2.35);
    s.addText(`0${i + 1}`, { x: x + 0.3, y: 2.72, w: 1, h: 0.35, fontFace: MONO, fontSize: 14, color: C.accent1, margin: 0, isTextBox: true, objectName: `num-${key}` });
    s.addText(head, { x: x + 0.3, y: 3.1, w: cw - 0.6, h: 0.45, fontFace: THEME.headFontFace, fontSize: 20, bold: true, color: C.background1, margin: 0, isTextBox: true, objectName: `head-${key}` });
    s.addText(body, { x: x + 0.3, y: 3.6, w: cw - 0.6, h: 1.15, fontSize: 14, color: C.background2, margin: 0, valign: 'top', isTextBox: true, objectName: `body-${key}` });
  });
  const sw = (W - 2 * M) / 3;
  [['1 tx', 'payment and reward, inseparable'], ['1 tx', 'to open a shop: mint stamps and fund the reserve'], ['0', 'servers, databases or hot keys']]
    .forEach(([big, small], i) => stat(s, M + i * sw, 4.95, sw - 0.3, big, small));
  notes(s, 'Three audiences, one transaction model. The numbers at the bottom are properties of the design, not projections.');
}

// ---------- 5. BCH usage ----------
pres.addSection({ title: 'BCH usage' });
{
  const s = pres.addSlide({ masterName: 'CONTENT_DARK', sectionTitle: 'BCH usage' });
  label(s, '// 05  BCH usage');
  s.addText('Two covenants do the work a company’s servers usually do', { placeholder: 'title' });
  const cw = (W - 2 * M - 0.35) / 2;
  codeCard(s, M, 2.5, cw, 2.75, 'StampIssuer.cash', [
    ['function earn() {', 'kw'],
    ['  require(output 0 == this issuer);', 'req'],
    ['  require(issuer value += N * fee);', 'req'],
    ['  require(output 1 pays shop', 'req'],
    ['          >= N * (rate - fee));', 'req'],
    ['}', 'kw'],
    ['// collect(): fees go only to the protocol', 'cmt'],
  ], 13);
  codeCard(s, M + cw + 0.35, 2.5, cw, 2.75, 'RewardReserve.cash', [
    ['function redeem() {', 'kw'],
    ['  require(output i == this reserve);', 'req'],
    ['  stampsIn = stamps after - before;', 'plain'],
    ['  require(stampsIn > 0);', 'req'],
    ['  require(value out >= in', 'req'],
    ['          - stampsIn * reward);', 'req'],
    ['}  // the shop cannot refuse', 'cmt'],
  ], 13);
  const facts = [
    ['CashTokens', 'stamps are a fungible token'],
    ['WizardConnect', 'one signature in the user’s wallet'],
    ['XO template', 'earn + redeem as an XO follow-up'],
    ['Tested', '23 contract tests, browser tests, live mainnet'],
  ];
  const fw = (W - 2 * M) / 4;
  facts.forEach(([head, body], i) => {
    s.addText([{ text: head, options: { bold: true, color: C.accent1, breakLine: true } }, { text: body, options: { color: C.background2, fontSize: 13 } }],
      { x: M + i * fw, y: 5.55, w: fw - 0.25, h: 1.0, fontSize: 15, margin: 0, valign: 'top', isTextBox: true, objectName: `fact-${i}` });
  });
  notes(s, 'StampIssuer releases N stamps only if output 1 pays the shop for them and the protocol fee stays in the contract. RewardReserve pays a fixed amount per stamp handed in. Written in CashScript; also packaged as an XO template.');
}

// ---------- 6. vision ----------
pres.addSection({ title: 'Vision' });
{
  const s = pres.addSlide({ masterName: 'CONTENT_DARK', sectionTitle: 'Vision' });
  label(s, '// 06  the vision');
  s.addText('The rewards layer for every BCH merchant', { placeholder: 'title' });
  const steps = [
    ['NOW', 'Live on mainnet', 'Anyone can open a shop today and print its QR poster.'],
    ['NEXT', 'Wallets and tills', 'Stamps shown natively through the XO template, and a plug-in for BCH point-of-sale apps.'],
    ['LATER', 'Stable rewards', 'Rewards priced in a BCH stablecoin, and a public shop directory read straight from the chain.'],
  ];
  const sw = (W - 2 * M - 2 * 0.35) / 3;
  s.addShape(pres.shapes.LINE, { x: M, y: 2.55, w: W - 2 * M, h: 0, line: { color: C.accent2, width: 1.5 }, objectName: 'timeline' });
  steps.forEach(([when, head, body], i) => {
    const x = M + i * (sw + 0.35);
    s.addShape(pres.shapes.OVAL, { x, y: 2.43, w: 0.24, h: 0.24, fill: { color: i === 0 ? C.accent1 : C.text1 }, line: { color: C.accent1, width: 2 }, objectName: `dot-${i}` });
    s.addText(when, { x, y: 2.85, w: sw, h: 0.3, fontFace: MONO, fontSize: 12, color: C.accent1, margin: 0, isTextBox: true, objectName: `when-${i}` });
    s.addText(head, { x, y: 3.2, w: sw, h: 0.45, fontFace: THEME.headFontFace, fontSize: 20, bold: true, color: C.background1, margin: 0, isTextBox: true, objectName: `vhead-${i}` });
    s.addText(body, { x, y: 3.7, w: sw - 0.2, h: 1.0, fontSize: 14, color: C.background2, margin: 0, valign: 'top', isTextBox: true, objectName: `vbody-${i}` });
  });
  card(s, M, 5.0, W - 2 * M, 1.4, C.accent5);
  s.addText([
    { text: 'Business model  ', options: { bold: true, color: C.accent1 } },
    { text: '1% of every rewarded payment accrues to the protocol inside the issuer contract: no invoicing, no accounts, enforced by script. Shops fund it from the card fees they no longer pay.', options: { color: C.background1 } },
  ], { x: M + 0.3, y: 5.2, w: W - 2 * M - 0.6, h: 1.0, fontSize: 16, margin: 0, valign: 'middle', isTextBox: true, objectName: 'business' });
  notes(s, 'Now, next, later. Revenue is enforced on-chain: each issuance must leave 1% in the issuer, and only the protocol treasury can collect it.');
}

// ---------- 7. thank you ----------
pres.addSection({ title: 'Thank you' });
{
  const s = pres.addSlide({ masterName: 'TITLE_DARK', sectionTitle: 'Thank you' });
  s.addText('// 07  thank you', { x: M, y: 1.75, w: 6.6, h: 0.35, fontFace: MONO, fontSize: 14, color: C.accent1, margin: 0, isTextBox: true, objectName: 'thanks-label' });
  s.addText('Try it', { placeholder: 'title' });
  s.addText([
    { text: URL_APP, options: { hyperlink: { url: `https://${URL_APP}` }, color: C.accent1, breakLine: true } },
    { text: URL_REPO, options: { hyperlink: { url: `https://${URL_REPO}` }, color: C.accent1 } },
  ], { x: M, y: 3.85, w: 6.8, h: 0.9, fontFace: MONO, fontSize: 18, margin: 0, valign: 'top', paraSpaceAfter: 6, isTextBox: true, objectName: 'thanks-links' });
  codeCard(s, 7.75, 1.75, 5.0, 2.45, 'two minutes, three clicks', [
    ['1  connect a BCH wallet', 'req'],
    ['2  pay 2,000 sats at Demo Café', 'req'],
    ['3  redeem your stamps for BCH', 'req'],
    ['', 'plain'],
    ['// or open your own shop', 'cmt'],
  ], 15);
  s.addText('Built by codeswithroh for BCH BLAZE 2026', { x: M, y: 5.6, w: 6.8, h: 0.4, fontSize: 14, color: C.background2, margin: 0, isTextBox: true, objectName: 'credit' });
  notes(s, 'Thank you. Open regulars-bch.vercel.app, connect a wallet, pay 2,000 sats at the demo shop and redeem the stamps. Or open your own shop.');
}

(async () => {
  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  console.log(`Wrote ${OUT}`);
})();
