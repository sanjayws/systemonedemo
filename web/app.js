import { MODELS, LIMITS, parseCriteria, validateRequest, validateResponse } from './lib/schema.js';
import { SCENARIOS, illustrativeResult } from './lib/scenarios.js';
import { imageDataUrl, prepareImages } from './lib/images.js';

const $ = id => document.getElementById(id);
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const percent = value => `${(value * 100).toFixed(1)}%`;
const questionCopy = question => ({ ...question, criteriaText: question.type === 'choice' ? Object.entries(question.criteria).map(([key, value]) => `${key} | ${value}`).join('\n') : question.type === 'score' ? question.criteria.join('\n') : '' });
let scenario = SCENARIOS[0], questions = [], sourceType = 'text', attachments = [], busy = false, uploading = false, abortController;
let responseData = null, requestSnapshot = null, illustration = false, rawTab = 'request';

function showNotice(message) { $('notice').textContent = message; $('notice').hidden = !message; }
function renderScenarios() {
  const category = $('category').value;
  $('scenarios').innerHTML = SCENARIOS.filter(item => category === 'all' || item.category === category).map(item => `<button type="button" class="scenario-button ${scenario?.id === item.id ? 'active' : ''}" data-scenario="${item.id}" aria-current="${scenario?.id === item.id ? 'true' : 'false'}"><span class="scenario-code">${item.code}</span>${escape(item.title)}</button>`).join('');
}
function clearResults() { responseData = null; requestSnapshot = null; illustration = false; $('export').disabled = true; renderResults(); }
function loadScenario(item) {
  if (busy || uploading) return;
  scenario = item;
  questions = item ? item.questions.map(questionCopy) : [{ id: 'decision', type: 'noul', instructions: '', criteriaText: '' }];
  $('source').value = item?.state ?? '';
  sourceType = item?.sourceType ?? 'text';
  attachments = [];
  $('image-input').value = '';
  $('scenario-category').textContent = item?.category.toUpperCase() ?? 'CUSTOM';
  $('scenario-code').textContent = item?.code ?? '—';
  $('scenario-title').textContent = item?.title ?? 'Your own experiment';
  $('scenario-description').textContent = item?.description ?? 'Bring your evidence, define the question, and explore the decision.';
  $('tip').textContent = item?.tip ?? 'Try one clear question first. For choice questions, include an “unknown” option if the source could be incomplete.';
  showNotice(''); renderScenarios(); renderQuestions(); renderImages(); renderSourceMode(); clearResults(); updateInputs();
}
function renderSourceMode() { $('text-mode').setAttribute('aria-pressed', String(sourceType === 'text')); $('json-mode').setAttribute('aria-pressed', String(sourceType === 'json')); }
function renderQuestions() {
  $('question-count').textContent = `${questions.length} question${questions.length === 1 ? '' : 's'}`;
  $('questions').innerHTML = questions.map((question, index) => `<div class="question-editor" data-index="${index}">
    <div class="question-top"><span class="question-id">${String(index + 1).padStart(2, '0')} / ${escape(question.id)}</span><label class="sr-only" for="type-${index}">Answer format for question ${index + 1}</label><select id="type-${index}" data-field="type"><option value="noul" ${question.type === 'noul' ? 'selected' : ''}>Yes / no</option><option value="choice" ${question.type === 'choice' ? 'selected' : ''}>Choose one</option><option value="score" ${question.type === 'score' ? 'selected' : ''}>Score a rubric</option></select>${questions.length > 1 ? `<button type="button" class="remove-question" data-remove="${index}" aria-label="Remove question ${index + 1}">×</button>` : ''}</div>
    <label for="instruction-${index}">Question</label><textarea id="instruction-${index}" data-field="instructions" maxlength="4000" rows="2" placeholder="What should Clef decide from the source?">${escape(question.instructions)}</textarea>
    ${question.type !== 'noul' ? `<label class="criteria-label" for="criteria-${index}">${question.type === 'choice' ? 'Allowed answers' : 'Score levels · lowest first'}</label><textarea class="criteria" id="criteria-${index}" data-field="criteriaText" rows="${Math.min(5, Math.max(3, question.criteriaText.split('\n').length))}" spellcheck="false" maxlength="64000">${escape(question.criteriaText)}</textarea><p class="field-hint">${question.type === 'choice' ? 'One option per line: name | description' : 'One level per line. Levels are numbered from 0.'}</p>` : '<p class="field-hint">Returns the probability that the answer is yes, from 0 to 1.</p>'}
    </div>`).join('');
  $('add-question').disabled = questions.length >= LIMITS.questions;
}
function makeRequest() {
  let source = $('source').value;
  if (sourceType === 'json') {
    try { source = JSON.parse(source); } catch { throw new Error('Content A is not valid JSON. Fix it or switch to Text.'); }
  }
  const query = Object.fromEntries(questions.map(question => [question.id, { type: question.type, instructions: question.instructions, ...(question.type !== 'noul' ? { criteria: parseCriteria(question.criteriaText, question.type) } : {}) }]));
  return validateRequest({ models: $('model').value === 'compare' ? ['clef', 'clef-flash'] : [$('model').value], state: source, questions: query, images: attachments.map(image => image.dataUrl) });
}
function currentSignature() { try { return JSON.stringify(makeRequest()); } catch { return null; } }
function resultStatus() {
  if (illustration) return 'ILLUSTRATION';
  if (responseData?.runs.every(run => run.status === 'error')) return 'MODEL ERROR';
  if (responseData?.runs.some(run => run.status === 'error')) return 'PARTIAL RESULT';
  return 'LIVE RESULT';
}
function presetMatches() {
  return scenario?.example && $('source').value === scenario.state && sourceType === (scenario.sourceType ?? 'text') && !attachments.length && JSON.stringify(questions) === JSON.stringify(scenario.questions.map(questionCopy));
}
function updateInputs() {
  $('char-count').textContent = `${$('source').value.length.toLocaleString()} / 32,000`;
  $('example').disabled = busy || uploading || !presetMatches();
  $('example').title = presetMatches() ? 'Hand-authored illustration for the unchanged preset' : 'Example output is available only for unchanged text presets. Reset the scenario to view it.';
  if (responseData && requestSnapshot) {
    const stale = currentSignature() !== JSON.stringify(requestSnapshot);
    $('result-status').textContent = stale ? 'INPUTS CHANGED' : resultStatus();
    const existing = $('results').querySelector('.stale-banner');
    if (stale && !existing) $('results').insertAdjacentHTML('afterbegin', '<div class="stale-banner">Inputs have changed. These results belong to the previous inputs. Run again to evaluate your changes.</div>');
    if (!stale) existing?.remove();
  }
  updateRaw();
}
function emptyMarkup(loading = false) { return `<div class="result-empty ${loading ? 'loading' : ''}"><div class="empty-graphic" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div><h3>${loading ? 'Evaluating your evidence…' : 'See the decision take shape.'}</h3><p>${loading ? 'Clef is evaluating your questions together. Each answer stays within the options you defined.' : 'Run a decision to see the answer and its probabilities. Edit the evidence, then run again to see what changes.'}</p></div>`; }
function renderResults() {
  if (!responseData) {
    $('results').innerHTML = emptyMarkup(busy);
    $('result-status').textContent = busy ? 'EVALUATING' : 'READY TO TEST';
    updateRaw(); return;
  }
  const runs = responseData.runs;
  $('results').innerHTML = `${illustration ? '<div class="sample-banner">Illustrative example · hand-authored, not a model run. No measured latency or token usage.</div>' : ''}${runs.map(run => {
    const info = MODELS[run.model];
    if (run.status === 'error') return `<div class="model-result"><h3 class="model-title"><span>${escape(info.label)}</span><span>${info.size}</span></h3><p class="model-error">${escape(run.error.message)}</p>${responseData.requestId ? `<p class="error-reference">Reference: ${escape(responseData.requestId)}</p>` : ''}</div>`;
    return `<div class="model-result"><h3 class="model-title"><span>${escape(info.label)} ${illustration ? '· example' : '· live'}</span><span>${info.size} DECISION MODEL</span></h3>${Object.entries(requestSnapshot.questions).map(([id, question]) => renderAnswer(id, question, run.result.answers[id])).join('')}${illustration ? '' : `<div class="run-metrics"><span><strong>${run.latencyMs.toLocaleString()} ms</strong> model response</span><span><strong>${run.result.usage.input_tokens.toLocaleString()}</strong> input tokens</span><span><strong>${run.result.usage.output_tokens.toLocaleString()}</strong> output tokens</span></div>`}</div>`;
  }).join('')}`;
  $('result-status').textContent = resultStatus();
  $('export').disabled = false; updateRaw();
}
function renderAnswer(id, question, answer) {
  if (!answer) return '<p class="model-error">No answer was returned for this question.</p>';
  let value, confidence, entries, winner;
  if (answer.type === 'noul') { value = answer.noul >= 0.5 ? 'Yes' : 'No'; confidence = `P(yes) ${percent(answer.noul)}`; entries = [['Yes', answer.noul], ['No', 1 - answer.noul]]; winner = answer.noul >= 0.5 ? 'Yes' : 'No'; }
  else if (answer.type === 'choice') { value = answer.choice.replaceAll('_', ' '); confidence = `${percent(answer.confidence)} confidence`; entries = Object.entries(answer.probabilities).sort((a,b) => b[1] - a[1]); winner = answer.choice; }
  else { value = `${answer.score.toFixed(2)} / ${question.criteria.length - 1}`; confidence = `${percent(answer.confidence)} confidence`; entries = Object.entries(answer.probabilities); winner = entries.reduce((best, row) => row[1] > best[1] ? row : best)[0]; }
  return `<article class="answer"><div class="answer-label">${escape(id)}<span class="answer-type">${answer.type === 'noul' ? 'YES / NO' : answer.type.toUpperCase()}</span></div><div class="decision-line"><span class="decision-value">${escape(value)}</span><span class="decision-confidence">${escape(confidence)}</span></div>${entries.map(([key, probability]) => {
    const label = answer.type === 'score' ? `${key} · ${question.criteria[Number(key)]}` : key.replaceAll('_', ' ');
    // Width is applied via CSSOM from a validated number, never user-supplied HTML.
    return `<div class="probability-row ${winner === key ? 'winner' : ''}"><div class="probability-label"><span>${escape(label)}</span><span>${percent(probability)}</span></div><div class="probability-track"><div class="probability-fill" data-probability="${probability}"></div></div></div>`;
  }).join('')}${answer.type === 'score' ? '<p class="score-note">A probability-weighted average of the rubric levels. It can fall between two levels.</p>' : ''}</article>`;
}
function updateBars() { document.querySelectorAll('[data-probability]').forEach(element => element.style.setProperty('--probability', `${Number(element.dataset.probability) * 100}%`)); }
function displayPayload(request) {
  if (!request) return null;
  const { models, ...payload } = request;
  const single = model => ({ model, ...payload, ...(payload.images ? { images: payload.images.map((image, index) => image.split(',')[0] + `,[image ${index + 1} base64 omitted in preview]`) } : {}) });
  return models.length === 1 ? single(models[0]) : models.map(single);
}
function rawValue() {
  if (rawTab === 'response') return responseData ?? { note: 'Run a decision to inspect the response.' };
  try { return displayPayload(requestSnapshot ?? makeRequest()); } catch (error) { return { note: error.message }; }
}
function updateRaw() { $('raw-json').textContent = JSON.stringify(rawValue(), null, 2); }
function updateControls() {
  const locked = busy || uploading;
  document.querySelectorAll('main input, main textarea, main select, main button, .sidebar button, .sidebar select').forEach(element => { if (element.id !== 'cancel') element.disabled = locked; });
  $('run-label').textContent = busy ? 'Evaluating…' : uploading ? 'Reading images…' : 'Run decision'; $('cancel').hidden = !busy;
  $('results').setAttribute('aria-busy', String(busy));
  if (!locked) { $('export').disabled = !responseData; $('add-question').disabled = questions.length >= LIMITS.questions; updateInputs(); }
}
function setBusy(value) { busy = value; updateControls(); }
async function runDecision() {
  if (busy || uploading) return;
  let input;
  try { input = makeRequest(); if (scenario?.requiresImage && !attachments.length) throw new Error('Attach an image to Content A for this scenario.'); }
  catch (error) { showNotice(error.message); return; }
  showNotice(''); clearResults(); setBusy(true); $('results').innerHTML = emptyMarkup(true); $('result-status').textContent = 'EVALUATING';
  abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort('timeout'), 60000);
  try {
    attachments = await prepareImages(attachments, input, abortController.signal);
    renderImages(); input = makeRequest();
    abortController.signal.throwIfAborted();
    const response = await fetch('/api/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: abortController.signal });
    let data;
    try { data = await response.json(); } catch { throw new Error('The server returned an unreadable response. Please try again.'); }
    if (data?.error) throw new Error(typeof data.error.message === 'string' ? data.error.message : 'The evaluation could not be completed. Please try again.');
    const validated = validateResponse(data, input);
    requestSnapshot = input; responseData = validated; illustration = false; renderResults(); updateBars();
    if (!response.ok) showNotice('The evaluation failed. See the error details in the output panel.');
  } catch (error) {
    showNotice(abortController.signal.aborted ? 'Stopped waiting for the result. An evaluation already sent to Cloudflare may still complete.' : error.message);
    renderResults();
  } finally { clearTimeout(timer); setBusy(false); if (!responseData) renderResults(); }
}
function renderImages() {
  $('images').innerHTML = attachments.map((image,index) => `<div class="image-chip"><img src="${escape(image.dataUrl)}" alt="Attached image ${index + 1}"><span>${escape(image.name)}${image.optimized ? ' · optimized' : ''}</span><button type="button" data-image-remove="${index}" aria-label="Remove ${escape(image.name)}">×</button></div>`).join('');
  $('image-note').hidden = !attachments.length;
  $('image-note').textContent = attachments.some(image => image.optimized)
    ? 'Images were optimized for evaluation. Fine details may be reduced; crop to the relevant area for small text.'
    : 'Images are optimized when needed to fit the model. Crop to the relevant area for small text.';
}
async function attachImages(files) {
  if (busy || uploading || !files.length) return;
  uploading = true; updateControls();
  showNotice('');
  try {
    if (attachments.length + files.length > 4) throw new Error('Attach up to four images.');
    if ([...attachments, ...files].reduce((sum, image) => sum + image.size, 0) > LIMITS.totalImageBytes) throw new Error('Combined image size must be at most 8 MiB.');
    const next = [];
    for (const file of files) {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Use PNG, JPEG, or WebP images.');
      if (file.size > LIMITS.imageBytes) throw new Error(`${file.name} is larger than 4 MiB.`);
      const bitmap = await createImageBitmap(file);
      const pixels = bitmap.width * bitmap.height; bitmap.close();
      if (pixels > 16000000) throw new Error(`${file.name} is larger than 16 megapixels.`);
      const dataUrl = await imageDataUrl(file);
      next.push({ name: file.name, size: file.size, file, dataUrl });
    }
    attachments.push(...next); renderImages(); updateInputs();
  } catch (error) { showNotice(error.message); }
  finally { $('image-input').value = ''; uploading = false; updateControls(); $('attach').focus(); }
}

$('category').addEventListener('change', renderScenarios);
$('scenarios').addEventListener('click', event => { const button = event.target.closest('[data-scenario]'); if (button) loadScenario(SCENARIOS.find(item => item.id === button.dataset.scenario)); });
$('blank').addEventListener('click', () => loadScenario(null));
$('reset').addEventListener('click', () => loadScenario(scenario));
$('source').addEventListener('input', updateInputs);
$('model').addEventListener('change', updateInputs);
$('text-mode').addEventListener('click', () => { sourceType = 'text'; renderSourceMode(); updateInputs(); });
$('json-mode').addEventListener('click', () => { sourceType = 'json'; renderSourceMode(); updateInputs(); });
$('questions').addEventListener('input', event => {
  const field = event.target.dataset.field, editor = event.target.closest('[data-index]');
  if (!editor || !['instructions', 'criteriaText'].includes(field)) return;
  questions[Number(editor.dataset.index)][field] = event.target.value; updateInputs();
});
$('questions').addEventListener('change', event => {
  if (event.target.dataset.field !== 'type') return;
  const focusId = event.target.id;
  const question = questions[Number(event.target.closest('[data-index]').dataset.index)];
  question.type = event.target.value;
  question.criteriaText = question.type === 'choice' ? 'yes | The source supports this option\nno | The source contradicts this option\nunknown | The source does not contain enough information' : question.type === 'score' ? 'Low\nMedium\nHigh' : '';
  renderQuestions(); updateInputs(); $(focusId).focus();
});
$('questions').addEventListener('click', event => { const button = event.target.closest('[data-remove]'); if (button && !busy) { questions.splice(Number(button.dataset.remove),1); renderQuestions(); updateInputs(); } });
$('add-question').addEventListener('click', () => {
  if (questions.length >= LIMITS.questions || busy) return;
  let number = questions.length + 1; while (questions.some(question => question.id === `question_${number}`)) number++;
  questions.push({ id: `question_${number}`, type: 'noul', instructions: '', criteriaText: '' }); renderQuestions(); updateInputs(); $(`instruction-${questions.length - 1}`).focus();
});
$('image-input').addEventListener('change', event => attachImages(Array.from(event.target.files)));
$('attach').addEventListener('click', () => $('image-input').click());
$('images').addEventListener('click', event => { const button = event.target.closest('[data-image-remove]'); if (button && !busy) { attachments.splice(Number(button.dataset.imageRemove),1); renderImages(); updateInputs(); } });
$('run').addEventListener('click', runDecision);
$('cancel').addEventListener('click', () => abortController?.abort('cancelled'));
document.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !$('guide').open) { event.preventDefault(); runDecision(); } });
$('example').addEventListener('click', () => {
  if (!presetMatches() || busy) return;
  requestSnapshot = makeRequest(); illustration = true;
  // One illustration is shown even in comparison mode: no fabricated model comparison.
  responseData = { illustrative: true, runs: [{ model: requestSnapshot.models[0], status: 'success', result: illustrativeResult(scenario, requestSnapshot.models[0]) }] };
  renderResults(); updateBars(); updateInputs(); showNotice('');
});
$('raw-request').addEventListener('click', () => { rawTab = 'request'; $('raw-request').setAttribute('aria-pressed','true'); $('raw-response').setAttribute('aria-pressed','false'); updateRaw(); });
$('raw-response').addEventListener('click', () => { rawTab = 'response'; $('raw-request').setAttribute('aria-pressed','false'); $('raw-response').setAttribute('aria-pressed','true'); updateRaw(); });
$('copy-json').addEventListener('click', async () => { try { await navigator.clipboard.writeText(JSON.stringify(rawValue(),null,2)); $('copy-json').textContent = 'Copied'; setTimeout(() => $('copy-json').textContent = 'Copy',1800); } catch { showNotice('Clipboard is unavailable. Select and copy the JSON from the panel.'); } });
$('export').addEventListener('click', () => {
  if (!responseData) return;
  const exportData = { exportedAt: new Date().toISOString(), illustrative: illustration, request: requestSnapshot, response: responseData };
  const url = URL.createObjectURL(new Blob([JSON.stringify(exportData,null,2)],{type:'application/json'}));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `systemone-${scenario?.id ?? 'custom'}-${illustration ? 'example' : 'result'}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
});
$('guide-open').addEventListener('click', () => $('guide').showModal());
$('guide-close').addEventListener('click', () => $('guide').close());
$('guide').addEventListener('click', event => { if (event.target === $('guide')) { const bounds = $('guide').getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) $('guide').close(); } });
loadScenario(scenario);
const canShowConfigNotice = () => !busy && !uploading && !responseData && $('notice').hidden;
fetch('/api/config').then(response => { if (!response.ok) throw new Error(); return response.json(); }).then(config => { if (config.mode === 'offline' && canShowConfigNotice()) showNotice('Local preview · live model access is not connected. Explore the presets with “View example output”, or run this Worker through Wrangler to use Cloudflare.'); }).catch(() => { if (canShowConfigNotice()) showNotice('Could not check model access. A live run will report any connection problem.'); });
