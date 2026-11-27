import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Presentation, PresentationFile } from '@oai/artifact-tool';

const root = process.cwd();
const buildDir = path.join(root, '.codex', 'safeher-ppt-build');
const outDir = path.join(root, 'deliverables');
const outPath = path.join(outDir, 'SafeHer_Project_Overview.pptx');
const skillDir = 'C:/Users/pramo/.codex/plugins/cache/openai-primary-runtime/presentations/26.1123.11515/skills/Presentations';
const pythonExecutable = 'C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1123-915-0_26.1123.915.0_x64__3k8sg7r9htsxt/dependencies/python/python.exe';
const navy = '#0B1020';
const panel = '#151D2D';
const ink = '#F4F5FA';
const muted = '#B7C0D0';
const lavender = '#AA98FF';
const red = '#F05A70';
const green = '#57D3A2';
const line = '#344056';
const ppt = Presentation.create({ slideSize: { width: 1280, height: 720 } });

function box(slide, x, y, w, h, fill = panel, stroke = line, radius = 20) {
  return slide.shapes.add({ geometry: 'roundRect', position: { left: x, top: y, width: w, height: h }, fill, line: { style: 'solid', fill: stroke, width: 1 }, borderRadius: radius });
}
function txt(slide, text, x, y, w, h, size = '18pt', color = ink, bold = false, opts = {}) {
  const shape = slide.shapes.add({ geometry: 'textbox', position: { left: x, top: y, width: w, height: h }, fill: 'none', line: { style: 'solid', fill: 'none', width: 0 }, text: { text } });
  shape.text.style = { fontFamily: 'Arial', fontSize: size, color, bold, verticalAlignment: opts.valign || 'middle', alignment: opts.align || 'left', wrap: true };
  shape.text.insets = 0;
  return shape;
}
function heading(slide, n, title, subtitle) {
  txt(slide, String(n).padStart(2, '0'), 68, 44, 48, 30, '12pt', lavender, true);
  txt(slide, title, 68, 84, 1120, 58, '34pt', ink, true);
  if (subtitle) txt(slide, subtitle, 70, 148, 1110, 35, '16pt', muted);
}
function arrow(slide, x, y, w = 42) {
  slide.shapes.add({ geometry: 'rightArrow', position: { left: x, top: y, width: w, height: 22 }, fill: lavender, line: { style: 'solid', fill: 'none', width: 0 } });
}

// 1. Cover
{
  const s = ppt.slides.add(); s.background.fill = navy;
  s.shapes.add({ geometry: 'rect', position: { left: 70, top: 92, width: 8, height: 126 }, fill: red, line: { style: 'solid', fill: 'none', width: 0 } });
  txt(s, 'WOMEN’S PERSONAL SAFETY SYSTEM', 104, 96, 700, 32, '13pt', lavender, true);
  txt(s, 'Safe Her', 100, 177, 840, 94, '58pt', ink, true);
  txt(s, 'Wearable fall alerts and an emergency response dashboard', 104, 292, 880, 74, '24pt', muted);
  txt(s, 'ESP32  /  MPU6050  /  GPS  /  USB SERIAL  /  WEB DASHBOARD', 104, 590, 980, 28, '12pt', '#8290A8', true);
  s.speakerNotes.text = 'Project overview. The presentation describes the current firmware and dashboard implementation.';
}

// 2. System architecture
{
  const s = ppt.slides.add(); s.background.fill = navy; heading(s, 1, 'System architecture', 'A wearable device sends live safety state to a browser dashboard over USB serial.');
  const items = [
    { x: 70, title: 'SENSORS & INPUT', rows: ['MPU6050 motion readings', 'GPS coordinates', 'Touch control'], color: '#28334A' },
    { x: 365, title: 'ESP32 FIRMWARE', rows: ['Samples accelerometer', 'Checks fall thresholds', 'Controls buzzer + LED', 'Prints status at 115200'], color: '#292442' },
    { x: 660, title: 'SAFE HER DASHBOARD', rows: ['USB serial connection', 'Live readings + history', 'Map + saved contacts', 'SOS screen + alarm'], color: '#1D3435' },
    { x: 955, title: 'ALERT SERVICES', rows: ['Email via Apps Script', 'SMS via Twilio (optional)', 'Provider status shown'], color: '#3A2632' },
  ];
  for (const item of items) {
    box(s, item.x, 248, 250, 246, item.color, line, 18);
    txt(s, item.title, item.x + 18, 270, 218, 32, '13pt', lavender, true);
    let yy = 326;
    for (const row of item.rows) { txt(s, row, item.x + 18, yy, 218, 36, '16pt', ink); yy += 42; }
  }
  arrow(s, 324, 358); arrow(s, 619, 358); arrow(s, 914, 358);
  txt(s, 'Browser + USB connection must be active for dashboard-triggered SOS notifications.', 74, 548, 1110, 44, '16pt', muted);
  s.speakerNotes.text = 'The browser uses the Web Serial API to read the ESP32 stream. External email and SMS providers need configuration.';
}

// 3. Fall detection and SOS flow
{
  const s = ppt.slides.add(); s.background.fill = navy; heading(s, 2, 'Fall detection and SOS flow', 'The current firmware uses an acceleration threshold sequence, not the ML model headers.');
  const steps = [
    { x: 72, title: 'FREEFALL', value: '< 0.65 g', note: 'Start detection window', fill: '#202A3C' },
    { x: 356, title: 'IMPACT', value: '> 2.5 g', note: 'Within 1.5 seconds', fill: '#332B40' },
    { x: 640, title: 'SOS ACTIVE', value: 'Device alert', note: 'Buzzer + LED activate', fill: '#482835' },
    { x: 924, title: 'DASHBOARD', value: 'Response view', note: 'Red ripple + alarm', fill: '#202F3A' },
  ];
  for (const step of steps) {
    box(s, step.x, 234, 236, 190, step.fill, line, 18);
    txt(s, step.title, step.x + 18, 258, 200, 28, '13pt', lavender, true);
    txt(s, step.value, step.x + 18, 308, 202, 44, '24pt', ink, true);
    txt(s, step.note, step.x + 18, 367, 200, 34, '15pt', muted);
  }
  arrow(s, 312, 316, 34); arrow(s, 596, 316, 34); arrow(s, 880, 316, 34);
  txt(s, 'Manual path', 74, 484, 170, 34, '16pt', red, true);
  txt(s, 'Touch activates SOS. Hold the touch control for 3 seconds to cancel.', 236, 484, 930, 34, '17pt', ink);
  txt(s, 'Configured email and optional SMS are attempted when the connected dashboard sees the first SOS: ACTIVE transition.', 74, 552, 1100, 55, '15pt', muted);
  s.speakerNotes.text = 'Firmware constants in WomenSafetyESP32.ino define the 0.65 g freefall threshold, 2.5 g impact threshold, and 1500 ms detection window. No fall_model.h, fall_features.h, or fall_filter.h include is used by that sketch.';
}

// 4. Dashboard and project scope
{
  const s = ppt.slides.add(); s.background.fill = navy; heading(s, 3, 'Dashboard and project scope', 'One place to review live device state and coordinate a response.');
  txt(s, 'WHAT USERS CAN DO', 76, 222, 500, 32, '13pt', lavender, true);
  const left = [
    ['Monitor', 'MPU6050 readings, connection state, SOS, and saved event history.'],
    ['Locate', 'View the latest GPS fix on a map and share a map link.'],
    ['Coordinate', 'Manage emergency contacts and review email / SMS provider status.'],
    ['Ask', 'Use the built-in assistant for system questions and nearby map searches.'],
  ];
  let y = 270;
  for (const [label, detail] of left) {
    txt(s, label, 78, y, 132, 34, '18pt', ink, true);
    txt(s, detail, 218, y, 440, 46, '15pt', muted);
    y += 67;
  }
  s.shapes.add({ geometry: 'rect', position: { left: 694, top: 224, width: 2, height: 342 }, fill: line, line: { style: 'solid', fill: 'none', width: 0 } });
  txt(s, 'IMPLEMENTATION', 740, 222, 450, 32, '13pt', lavender, true);
  txt(s, 'DEVICE', 742, 279, 110, 24, '12pt', red, true);
  txt(s, 'ESP32 firmware + MPU6050 + GPS + touch control', 742, 307, 450, 45, '16pt', ink);
  txt(s, 'WEB APP', 742, 377, 110, 24, '12pt', red, true);
  txt(s, 'JavaScript dashboard + local browser contact storage', 742, 405, 450, 45, '16pt', ink);
  txt(s, 'ALERTS', 742, 475, 110, 24, '12pt', red, true);
  txt(s, 'Node API + Supabase in production + Google Apps Script email', 742, 503, 450, 54, '16pt', ink);
  txt(s, 'Email acceptance is not proof of final delivery. Public hosting needs serverless API adaptation and access control.', 76, 620, 1114, 38, '13pt', '#8996AB');
  s.speakerNotes.text = 'The chat assistant uses deterministic intent rules and dashboard state. Vercel deployment requires adapting the current long-running Node server to Functions and securing routes before exposing it publicly.';
}

await fs.mkdir(outDir, { recursive: true });
await fs.mkdir(buildDir, { recursive: true });
for (let i = 0; i < ppt.slides.items.length; i++) {
  const blob = await ppt.export({ slide: ppt.slides.items[i], format: 'png', scale: 1 });
  await fs.writeFile(path.join(buildDir, `slide-${i + 1}.png`), new Uint8Array(await blob.arrayBuffer()));
}
const draft = path.join(buildDir, 'candidate.pptx');
await (await PresentationFile.exportPptx(ppt)).save(draft);
const { finalizePresentation } = await import(pathToFileURL(path.join(skillDir, 'container_tools/artifact_tool_utils.mjs')).href);
const final = await finalizePresentation({
  explicitTotalSlideCount: 4,
  requiredNativeTableOwnerSlides: [],
  requiredNativeChartOwnerSlides: [],
  workspaceDir: root,
  candidatePath: draft,
  finalPath: outPath,
  pythonExecutable,
  integrityValidatorPath: path.join(skillDir, 'container_tools/inspect_presentation_package_integrity.py'),
  layoutValidatorPath: path.join(skillDir, 'container_tools/inspect_presentation_layout_geometry.py'),
  layoutArgs: ['--expected-slide-size-emu', '12192000,6858000', '--validate-bullet-geometry', '--validate-heading-fit'],
  fontPolicy: { basis: 'design', families: ['Arial'] },
  verifyArtifactToolImport: true,
  receiptPath: path.join(buildDir, 'validation.json'),
});
console.log(JSON.stringify({ outPath, final }));
