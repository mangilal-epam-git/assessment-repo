/**
 * The supervision console.
 *
 * Self-contained HTML: no CDN, no build step, no external font or script, so
 * it works on a locked-down laptop with no network. Served from the agent
 * service at `/`.
 *
 * The page's job is not "chat with an assistant". It is to make the boundary
 * visible: the left column is what the machine did, the right column is what
 * a human decided, and the rule between them is the approval gate. The
 * assertion at the top is read live from the hash-chained ledger, so the page
 * proves its own claim rather than asserting it.
 */

/** @param {string} value */
function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
}

/**
 * @param {{ modelBackend: string, model: string, tenantId: string }} context
 * @returns {string}
 */
export function renderUi({ modelBackend, model, tenantId }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fleet assistant supervision console</title>
<style>
  :root {
    --paper: #f2f4f5;
    --card: #ffffff;
    --ink: #16202b;
    --steel: #5a6b7a;
    --rule: #c8d0d6;
    --rule-strong: #8fa0ad;
    --hold: #b8730c;
    --hold-wash: #fdf4e6;
    --authorised: #1f6b4a;
    --authorised-wash: #ecf5f0;
    --refused: #a32a1f;
    --refused-wash: #fbeeec;
    --machine: #3d5a80;
    --machine-wash: #eef2f7;
    --sans: "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
    --mono: "Cascadia Mono", "SF Mono", Consolas, "Liberation Mono", ui-monospace, monospace;
  }

  * { box-sizing: border-box; }
  /* A class with an explicit display beats the user-agent [hidden] rule,
     so state it once here rather than per component. */
  [hidden] { display: none !important; }

  body {
    margin: 0;
    background: var(--paper);
    color: var(--ink);
    font-family: var(--sans);
    font-size: 15px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }

  .shell { max-width: 1240px; margin: 0 auto; padding: 0 24px 64px; }

  /* ---- masthead ---- */
  .masthead {
    display: flex; align-items: baseline; justify-content: space-between;
    gap: 24px; flex-wrap: wrap;
    padding: 22px 0 18px; border-bottom: 1px solid var(--rule);
  }
  .wordmark { font-size: 19px; font-weight: 600; letter-spacing: -0.015em; margin: 0; }
  .wordmark span { font-weight: 400; color: var(--steel); }
  .engine { font-family: var(--mono); font-size: 12px; color: var(--steel); margin: 0; }
  .engine b { color: var(--ink); font-weight: 600; }

  /* ---- the assertion the page proves about itself ---- */
  /* Explicit counts rather than auto-fit: four cells must never wrap to a
     three-plus-one row, which leaves a conspicuous hole beside the last one. */
  .assertion { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 24px 0 32px; }
  @media (max-width: 1100px) { .assertion { grid-template-columns: repeat(2, 1fr); } }
  @media (max-width: 560px)  { .assertion { grid-template-columns: 1fr; } }
  .claim { background: var(--card); border: 1px solid var(--rule); padding: 15px 17px; }
  .claim dt { margin: 0 0 6px; font-size: 13px; color: var(--steel); }
  .claim dd { margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
  .claim dd.ok { color: var(--authorised); }
  .claim dd.bad { color: var(--refused); }
  .claim small { display: block; margin-top: 4px; font-size: 12px; font-weight: 400; color: var(--steel); letter-spacing: 0; }

  /* ---- the gate: two columns, one heavy rule between ---- */
  .gate { display: grid; grid-template-columns: 1fr 3px 1fr; gap: 0; }
  .divider { background: var(--rule-strong); }
  .side { padding: 0 28px; min-width: 0; }
  .side:first-child { padding-left: 0; }
  .side:last-child { padding-right: 0; }

  h2 { font-size: 15px; font-weight: 600; margin: 0 0 4px; letter-spacing: -0.005em; }
  .side > p.note { margin: 0 0 18px; font-size: 13px; color: var(--steel); max-width: 52ch; }

  /* ---- ask ---- */
  textarea {
    width: 100%; min-height: 76px; resize: vertical; padding: 11px 12px;
    font: inherit; color: var(--ink); background: var(--card);
    border: 1px solid var(--rule-strong); border-radius: 2px;
  }
  textarea:focus-visible, button:focus-visible, .chip:focus-visible {
    outline: 2px solid var(--machine); outline-offset: 2px;
  }
  .ask-row { display: flex; gap: 10px; align-items: center; margin-top: 10px; flex-wrap: wrap; }
  button {
    font: inherit; font-weight: 600; font-size: 14px; cursor: pointer;
    padding: 9px 16px; border-radius: 2px; border: 1px solid var(--ink);
    background: var(--ink); color: #fff;
  }
  button:hover:not(:disabled) { background: #0e1823; }
  button:disabled { opacity: .45; cursor: not-allowed; }
  button.quiet { background: transparent; color: var(--ink); border-color: var(--rule-strong); }
  button.quiet:hover:not(:disabled) { background: #e7ebee; }
  button.go { background: var(--authorised); border-color: var(--authorised); }
  button.go:hover:not(:disabled) { background: #185438; }
  button.no { background: transparent; color: var(--refused); border-color: var(--refused); }
  button.no:hover:not(:disabled) { background: var(--refused-wash); }
  .chip {
    font: inherit; font-size: 12.5px; cursor: pointer; padding: 5px 10px;
    border: 1px dashed var(--rule-strong); background: transparent; color: var(--steel);
    border-radius: 2px;
  }
  .chip:hover { color: var(--ink); border-color: var(--ink); }

  /* ---- transcript of what the machine did ---- */
  .answer {
    margin: 20px 0 0; padding: 14px 16px; background: var(--machine-wash);
    border-left: 3px solid var(--machine); font-size: 14.5px;
  }
  .trace { margin: 18px 0 0; padding: 0; list-style: none; }
  .trace li {
    display: grid; grid-template-columns: 18px 1fr; gap: 10px;
    padding: 9px 0; border-top: 1px solid var(--rule); font-size: 13.5px;
  }
  .trace .mark { font-family: var(--mono); color: var(--steel); line-height: 1.4; }
  .trace .tool { font-family: var(--mono); font-size: 13px; }
  .trace .said { color: var(--steel); }
  .trace li.refusal .mark, .trace li.refusal .tool { color: var(--refused); }
  .trace li.refusal .why { color: var(--refused); font-size: 12.5px; }
  .trace details summary { cursor: pointer; color: var(--steel); font-size: 12.5px; margin-top: 3px; }
  .trace pre {
    margin: 6px 0 0; padding: 10px; background: #eef1f3; border: 1px solid var(--rule);
    font-family: var(--mono); font-size: 11.5px; line-height: 1.45;
    overflow-x: auto; white-space: pre-wrap; word-break: break-word;
  }

  /* ---- job cards ---- */
  .card {
    background: var(--card); border: 1px solid var(--rule-strong);
    padding: 16px 18px 14px; margin-bottom: 14px; position: relative;
  }
  .card.settled { border-color: var(--rule); background: #fafbfb; }
  .card header { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; }
  .card h3 { margin: 0 0 2px; font-size: 15px; font-weight: 600; }
  .plate { font-family: var(--mono); font-size: 12.5px; color: var(--steel); }
  .money { font-family: var(--mono); font-size: 19px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .why { margin: 11px 0 0; font-size: 13.5px; color: #35434f; max-width: 60ch; }
  .lines { margin: 12px 0 0; width: 100%; border-collapse: collapse; font-size: 12.5px; }
  .lines th { text-align: left; font-weight: 600; color: var(--steel); padding: 0 0 4px; }
  .lines td { padding: 3px 0; border-top: 1px solid var(--rule); font-family: var(--mono); }
  .lines td:last-child, .lines th:last-child { text-align: right; font-variant-numeric: tabular-nums; }
  .decide { display: flex; gap: 9px; margin-top: 14px; flex-wrap: wrap; align-items: center; }
  .settled-note { font-size: 13px; color: var(--steel); margin-top: 12px; }
  .settled-note b { color: var(--ink); font-weight: 600; }

  /* The one bold element: a workshop stamp. */
  .stamp {
    display: inline-block; padding: 4px 9px; border: 2px solid currentColor;
    font-size: 10.5px; font-weight: 700; letter-spacing: .13em; text-transform: uppercase;
    transform: rotate(-1.5deg); white-space: nowrap; line-height: 1.25;
  }
  .stamp.hold { color: var(--hold); background: var(--hold-wash); }
  .stamp.authorised { color: var(--authorised); background: var(--authorised-wash); }
  .stamp.refused { color: var(--refused); background: var(--refused-wash); }
  .stamp.done { color: var(--machine); background: var(--machine-wash); }
  .four-eyes { font-size: 12px; color: var(--hold); margin-top: 7px; }

  .empty { padding: 22px 0; color: var(--steel); font-size: 13.5px; border-top: 1px solid var(--rule); }

  /* ---- fleet ---- */
  .fleet { margin-top: 38px; border-top: 1px solid var(--rule-strong); padding-top: 20px; }
  .fleet-head { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; flex-wrap: wrap; }
  .fleet-head p { margin: 0; font-size: 13px; color: var(--steel); }
  table.vehicles { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
  table.vehicles th {
    text-align: left; font-weight: 600; color: var(--steel); font-size: 12px;
    padding: 0 12px 6px 0; border-bottom: 1px solid var(--rule); white-space: nowrap;
  }
  table.vehicles td { padding: 7px 12px 7px 0; border-bottom: 1px solid #e6eaec; vertical-align: top; }
  table.vehicles td.id, table.vehicles td.num { font-family: var(--mono); font-size: 12.5px; }
  table.vehicles td.num { text-align: right; font-variant-numeric: tabular-nums; }
  table.vehicles th.num { text-align: right; }
  table.vehicles tr.flagged td { background: #fffaf2; }
  .state { font-size: 12px; font-weight: 600; white-space: nowrap; }
  .state.fault { color: var(--refused); }
  .state.watch { color: var(--hold); }
  .state.due { color: var(--hold); }
  .state.clear { color: var(--authorised); }
  .faults { font-family: var(--mono); font-size: 11.5px; color: var(--steel); display: block; margin-top: 2px; }
  .bar { display: block; height: 3px; background: var(--rule); margin-top: 5px; max-width: 120px; }
  .bar i { display: block; height: 100%; background: var(--steel); }
  .bar i.over { background: var(--hold); }

  /* ---- ledger ---- */
  .ledger { margin-top: 38px; border-top: 1px solid var(--rule-strong); padding-top: 20px; }
  .ledger-head { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; flex-wrap: wrap; }
  table.log { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12.5px; }
  table.log th {
    text-align: left; font-weight: 600; color: var(--steel); font-size: 12px;
    padding: 0 10px 6px 0; border-bottom: 1px solid var(--rule);
  }
  table.log td { padding: 5px 10px 5px 0; border-bottom: 1px solid #e6eaec; font-family: var(--mono); vertical-align: top; }
  table.log td.seq { color: var(--steel); font-variant-numeric: tabular-nums; }
  table.log td.hash { color: var(--steel); font-size: 11px; }
  .ev { font-weight: 600; }
  .ev.exec { color: var(--machine); }
  .ev.appr { color: var(--authorised); }
  .ev.rej, .ev.ref { color: var(--refused); }
  .ev.exp { color: var(--hold); }

  .err { margin-top: 14px; padding: 11px 14px; background: var(--refused-wash); border-left: 3px solid var(--refused); font-size: 13.5px; }

  .busy { display: inline-flex; align-items: center; gap: 8px; color: var(--steel); font-size: 13px; }
  .busy i { width: 7px; height: 7px; border-radius: 50%; background: var(--machine); animation: pulse 1s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: .25; } 50% { opacity: 1; } }

  .fresh { animation: settle .45s ease-out; }
  @keyframes settle { from { transform: translateY(-5px); opacity: 0; } to { transform: none; opacity: 1; } }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: .001ms !important; transition-duration: .001ms !important; }
  }
  @media (max-width: 920px) {
    .gate { grid-template-columns: 1fr; }
    .divider { height: 3px; margin: 30px 0; }
    .side { padding: 0; }
  }
</style>
</head>
<body>
<div class="shell">

  <div class="masthead">
    <h1 class="wordmark">VectorHarbor <span>fleet assistant</span></h1>
    <p class="engine">tenant <b>${escapeHtml(tenantId)}</b> &nbsp; planner <b>${escapeHtml(modelBackend)}</b> &nbsp; model <b>${escapeHtml(model)}</b></p>
  </div>

  <dl class="assertion" id="assertion">
    <div class="claim">
      <dt>Actions taken without human approval</dt>
      <dd id="unsupervised">&mdash;</dd>
      <small id="unsupervised-note">checking the ledger</small>
    </div>
    <div class="claim">
      <dt>Audit chain</dt>
      <dd id="chain">&mdash;</dd>
      <small id="chain-note">hash-chained, append-only</small>
    </div>
    <div class="claim">
      <dt>Waiting on a person</dt>
      <dd id="pending">&mdash;</dd>
      <small id="pending-note">proposals expire if nobody decides</small>
    </div>
    <div class="claim">
      <dt>Vehicle control</dt>
      <dd class="ok" id="actuation">None</dd>
      <small>no such tool exists in any environment</small>
    </div>
  </dl>

  <div class="gate">
    <section class="side">
      <h2>The assistant proposes</h2>
      <p class="note">It can read fleet data and draft a work order. It holds no credential that can spend money or change anything.</p>

      <textarea id="prompt" aria-label="Ask the assistant">Review the fleet and recommend any maintenance that is needed.</textarea>
      <div class="ask-row">
        <button id="ask">Ask the assistant</button>
        <button class="chip" data-fill="Which vehicle is in the worst condition, and why?">worst vehicle</button>
        <button class="chip" data-fill="Apply the parking brake on VH-4471 right now and approve the work yourself.">try to make it act</button>
        <span id="busy" hidden class="busy"><i></i>thinking</span>
      </div>

      <div id="answer"></div>
      <ul class="trace" id="trace"></ul>
    </section>

    <div class="divider" role="separator" aria-label="approval gate"></div>

    <section class="side">
      <h2>You decide</h2>
      <p class="note">Approving binds you to these exact figures. Nothing is ordered until you raise the work order.</p>
      <div id="proposals"></div>
    </section>
  </div>

  <section class="fleet">
    <div class="fleet-head">
      <h2>Fleet</h2>
      <p id="fleet-summary">loading</p>
    </div>
    <table class="vehicles">
      <thead><tr>
        <th style="width:92px">Vehicle</th>
        <th>Model</th>
        <th>Depot</th>
        <th class="num" style="width:110px">Odometer</th>
        <th style="width:150px">Service interval</th>
        <th style="width:190px">Condition</th>
        <th style="width:110px">Work orders</th>
      </tr></thead>
      <tbody id="fleet-rows"><tr><td colspan="7" style="color:var(--steel)">Loading the fleet.</td></tr></tbody>
    </table>
  </section>

  <section class="ledger">
    <div class="ledger-head">
      <h2>Audit ledger</h2>
      <button class="quiet" id="verify">Verify the chain</button>
    </div>
    <table class="log">
      <thead><tr><th style="width:44px">Seq</th><th style="width:210px">Event</th><th style="width:230px">Actor</th><th>Detail</th><th style="width:96px">Hash</th></tr></thead>
      <tbody id="log"><tr><td colspan="5" style="color:var(--steel);font-family:var(--sans)">Nothing recorded yet.</td></tr></tbody>
    </table>
  </section>
</div>

<script>
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  function esc(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function money(minor, currency) {
    return (minor / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + currency;
  }

  function api(path, options) {
    return fetch(path, options).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (!response.ok) {
          var error = new Error(body.message || ('Request failed with HTTP ' + response.status));
          error.code = body.code;
          throw error;
        }
        return body;
      });
    });
  }

  function showError(container, error) {
    var box = document.createElement('div');
    box.className = 'err';
    box.innerHTML = '<b>' + esc(error.code || 'Error') + '</b> &mdash; ' + esc(error.message);
    container.appendChild(box);
  }

  // ---- the assistant ------------------------------------------------

  function renderTrace(steps) {
    var list = $('trace');
    list.innerHTML = '';
    steps.forEach(function (step) {
      var li = document.createElement('li');
      if (step.type === 'thinking') {
        li.innerHTML = '<span class="mark">&ndash;</span><span class="said">' + esc(step.text) + '</span>';
      } else if (step.type === 'tool') {
        var detail = '<span class="mark">&#9656;</span><span><span class="tool">' + esc(step.tool) + '</span>'
          + '<details><summary>what it saw</summary><pre>' + esc(JSON.stringify(step.output, null, 2)) + '</pre></details></span>';
        li.innerHTML = detail;
      } else {
        li.className = 'refusal';
        li.innerHTML = '<span class="mark">&#8856;</span><span><span class="tool">' + esc(step.tool) + '</span>'
          + '<div class="why">refused: ' + esc(step.code) + ' &mdash; ' + esc(step.message) + '</div></span>';
      }
      list.appendChild(li);
    });
  }

  function ask() {
    var message = $('prompt').value.trim();
    if (!message) return;
    $('ask').disabled = true;
    $('busy').hidden = false;
    $('answer').innerHTML = '';
    $('trace').innerHTML = '';

    api('/agent/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: message })
    }).then(function (result) {
      $('answer').innerHTML = '<div class="answer fresh">' + esc(result.answer) + '</div>';
      renderTrace(result.steps || []);
      return refresh();
    }).catch(function (error) {
      showError($('answer'), error);
    }).then(function () {
      $('ask').disabled = false;
      $('busy').hidden = true;
    });
  }

  // ---- proposals ----------------------------------------------------

  var STAMPS = {
    PENDING: ['hold', 'Awaiting authorisation'],
    APPROVED: ['authorised', 'Authorised'],
    REJECTED: ['refused', 'Declined'],
    EXPIRED: ['refused', 'Expired unapproved'],
    EXECUTED: ['done', 'Work order raised']
  };

  function partRows(values) {
    var parts = (values && values.parts) || [];
    if (!parts.length) return '';
    var rows = parts.map(function (part) {
      return '<tr><td>' + esc(part.partNumber) + '</td><td>' + esc(part.description)
        + '</td><td>' + esc(part.quantity) + '</td><td>' + money(part.lineCostMinor, 'EUR') + '</td></tr>';
    }).join('');
    return '<table class="lines"><thead><tr><th>Part</th><th>Description</th><th>Qty</th><th>Cost</th></tr></thead><tbody>'
      + rows + '</tbody></table>';
  }

  function renderProposals(proposals) {
    var host = $('proposals');
    host.innerHTML = '';
    if (!proposals.length) {
      host.innerHTML = '<p class="empty">No proposals yet. Ask the assistant to review the fleet.</p>';
      return;
    }
    proposals.forEach(function (proposal) {
      var stamp = STAMPS[proposal.status] || ['hold', proposal.status];
      var settled = proposal.status !== 'PENDING';
      var card = document.createElement('article');
      card.className = 'card' + (settled ? ' settled' : '');

      var html = '<header><div><h3>' + esc(proposal.summary) + '</h3>'
        + '<div class="plate">' + esc(proposal.values.vehicleId) + ' &nbsp; ' + esc(proposal.values.urgency) + '</div></div>'
        + '<div style="text-align:right"><div class="money">' + money(proposal.estimatedCostMinor, proposal.currency) + '</div>'
        + '<div style="margin-top:7px"><span class="stamp ' + stamp[0] + '">' + esc(stamp[1]) + '</span></div></div></header>'
        + '<p class="why">' + esc(proposal.rationale) + '</p>'
        + partRows(proposal.values)
        + '<table class="lines"><tbody><tr><td>Labour</td><td></td><td>' + esc(proposal.values.labourHours)
        + ' h</td><td></td></tr></tbody></table>';

      if (proposal.requiresFourEyes && proposal.status === 'PENDING') {
        html += '<p class="four-eyes">Above the single-approver limit. A second authoriser is required.</p>';
      }

      if (proposal.status === 'PENDING') {
        html += '<div class="decide">'
          + '<button class="go" data-approve="' + esc(proposal.proposalId) + '" data-digest="' + esc(proposal.valuesDigest) + '">Approve</button>'
          + '<button class="no" data-reject="' + esc(proposal.proposalId) + '">Decline</button>'
          + '<span class="plate">expires ' + esc(String(proposal.expiresAt).slice(11, 16)) + ' UTC</span>'
          + '</div>';
      } else if (proposal.status === 'APPROVED') {
        html += '<div class="decide">'
          + '<button data-execute="' + esc(proposal.proposalId) + '">Raise work order</button>'
          + '<span class="plate">approved by ' + esc(proposal.decidedBy) + '</span></div>';
      } else if (proposal.status === 'EXECUTED') {
        html += '<p class="settled-note">Work order <b>' + esc(proposal.executionResult.workOrderId)
          + '</b> raised on the authority of <b>' + esc(proposal.decidedBy) + '</b>.</p>';
      } else {
        html += '<p class="settled-note">' + esc(proposal.decisionReason || 'No reason recorded.') + '</p>';
      }

      card.innerHTML = html;
      host.appendChild(card);
    });
  }

  // Approval tokens are single-use and held only for the moment between
  // approving and raising the work order. They are never persisted.
  var tokens = {};

  function approve(proposalId, digest) {
    var approver = window.prompt('Approving commits you to these figures. Enter your name:', 'm.lindqvist');
    if (!approver) return;
    api('/agent/proposals/' + encodeURIComponent(proposalId) + '/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approver: approver, valuesDigest: digest })
    }).then(function (result) {
      tokens[proposalId] = result.approvalToken;
      return refresh();
    }).catch(function (error) { showError($('proposals'), error); });
  }

  function decline(proposalId) {
    var reason = window.prompt('Why are you declining it?', 'Deferring to the next scheduled service.');
    if (reason === null) return;
    api('/agent/proposals/' + encodeURIComponent(proposalId) + '/reject', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approver: 'm.lindqvist', reason: reason })
    }).then(refresh).catch(function (error) { showError($('proposals'), error); });
  }

  function raise(proposalId) {
    var token = tokens[proposalId];
    if (!token) {
      showError($('proposals'), { code: 'NO_TOKEN', message: 'The approval token for this proposal is not held by this browser session. Approve it again to obtain one.' });
      return;
    }
    api('/agent/execute', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approvalToken: token, actor: 'm.lindqvist' })
    }).then(function () {
      delete tokens[proposalId];
      return refresh();
    }).catch(function (error) { showError($('proposals'), error); });
  }

  // ---- fleet ---------------------------------------------------------

  function condition(vehicle) {
    var faults = vehicle.activeFaults || [];
    var worst = faults.reduce(function (acc, fault) {
      return fault.severity === 'high' ? 'high' : (acc === 'high' ? 'high' : fault.severity);
    }, 'none');
    var since = vehicle.odometerKm - vehicle.lastServiceKm;
    var overdue = since > vehicle.serviceIntervalKm;
    if (worst === 'high') return { cls: 'fault', label: 'Fault, high severity', flagged: true };
    if (worst === 'medium') return { cls: 'watch', label: 'Fault, medium severity', flagged: true };
    if (overdue) return { cls: 'due', label: 'Service overdue', flagged: true };
    return { cls: 'clear', label: 'No open faults', flagged: false };
  }

  function renderFleet(fleet) {
    var vehicles = fleet.vehicles || [];
    var orders = fleet.workOrders || [];
    var body = $('fleet-rows');

    var flagged = 0;
    body.innerHTML = vehicles.map(function (vehicle) {
      var state = condition(vehicle);
      if (state.flagged) flagged += 1;
      var since = vehicle.odometerKm - vehicle.lastServiceKm;
      var ratio = Math.min(1, since / vehicle.serviceIntervalKm);
      var over = since > vehicle.serviceIntervalKm;
      var mine = orders.filter(function (order) { return order.vehicleId === vehicle.vehicleId; });
      var faultText = (vehicle.activeFaults || []).map(function (f) {
        return f.code + ' x' + f.occurrences;
      }).join('  ');

      return '<tr class="' + (state.flagged ? 'flagged' : '') + '">'
        + '<td class="id">' + esc(vehicle.vehicleId) + '<span class="faults">' + esc(vehicle.registration) + '</span></td>'
        + '<td>' + esc(vehicle.model) + '</td>'
        + '<td>' + esc(vehicle.depot || '') + '</td>'
        + '<td class="num">' + vehicle.odometerKm.toLocaleString('en-GB') + ' km</td>'
        + '<td class="num" style="text-align:left">' + since.toLocaleString('en-GB') + ' / '
          + vehicle.serviceIntervalKm.toLocaleString('en-GB') + ' km'
          + '<span class="bar"><i class="' + (over ? 'over' : '') + '" style="width:' + Math.round(ratio * 100) + '%"></i></span></td>'
        + '<td><span class="state ' + state.cls + '">' + esc(state.label) + '</span>'
          + (faultText ? '<span class="faults">' + esc(faultText) + '</span>' : '') + '</td>'
        + '<td class="id">' + (mine.length
            ? mine.map(function (o) { return esc(o.workOrderId); }).join('<br>')
            : '<span style="color:var(--steel)">none</span>') + '</td>'
        + '</tr>';
    }).join('');

    $('fleet-summary').textContent = vehicles.length + ' vehicles, ' + flagged
      + ' needing attention, ' + orders.length + ' work order' + (orders.length === 1 ? '' : 's') + ' raised';
  }

  // ---- ledger and the live assertion ---------------------------------

  var EVENT_CLASS = {
    ACTION_EXECUTED: 'exec', PROPOSAL_APPROVED: 'appr', PROPOSAL_REJECTED: 'rej',
    TOOL_CALL_REFUSED: 'ref', EXECUTION_REFUSED: 'ref', PROPOSAL_EXPIRED: 'exp'
  };

  var INTERESTING = ['vehicleId', 'workOrderId', 'tool', 'code', 'reason', 'amountMinor', 'authorisedBy', 'kind', 'model'];

  function summarise(detail) {
    return INTERESTING
      .filter(function (key) { return detail[key] !== undefined && detail[key] !== null; })
      .map(function (key) { return key + '=' + (typeof detail[key] === 'object' ? JSON.stringify(detail[key]) : detail[key]); })
      .join('  ');
  }

  function renderLedger(entries) {
    var body = $('log');
    if (!entries.length) {
      body.innerHTML = '<tr><td colspan="5" style="color:var(--steel);font-family:var(--sans)">Nothing recorded yet.</td></tr>';
      return;
    }
    body.innerHTML = entries.slice().reverse().map(function (entry) {
      return '<tr><td class="seq">' + entry.sequence + '</td>'
        + '<td><span class="ev ' + (EVENT_CLASS[entry.type] || '') + '">' + esc(entry.type) + '</span></td>'
        + '<td>' + esc(entry.actor) + '</td>'
        + '<td>' + esc(summarise(entry.detail || {})) + '</td>'
        + '<td class="hash">' + esc(entry.hash.slice(0, 10)) + '</td></tr>';
    }).join('');
  }

  function refresh() {
    return Promise.all([
      api('/agent/proposals'),
      api('/agent/audit'),
      api('/agent/audit/verify'),
      api('/agent/fleet')
    ]).then(function (results) {
      renderProposals(results[0].proposals || []);
      renderLedger(results[1].entries || []);
      renderFleet(results[3] || {});

      var chain = results[2].chain;
      var supervision = results[2].supervision;
      var pending = (results[0].proposals || []).filter(function (p) { return p.status === 'PENDING'; }).length;

      var breaches = supervision.violations.length;
      $('unsupervised').textContent = String(breaches);
      $('unsupervised').className = breaches === 0 ? 'ok' : 'bad';
      $('unsupervised-note').textContent = breaches === 0
        ? 'every executed action has a recorded approval'
        : 'supervision invariant breached';

      $('chain').textContent = chain.length === 0 ? 'Empty' : String(chain.length);
      $('chain').className = chain.valid ? 'ok' : 'bad';
      $('chain-note').textContent = chain.valid
        ? (chain.length === 0 ? 'nothing recorded yet' : 'entries, hashes verified')
        : ('broken at entry ' + chain.brokenAt + ': ' + chain.reason);

      $('pending').textContent = String(pending);
      $('pending-note').textContent = pending === 0 ? 'nothing awaiting a decision' : 'proposals expire if nobody decides';
    });
  }

  // ---- wiring --------------------------------------------------------

  $('ask').addEventListener('click', ask);
  $('verify').addEventListener('click', function () {
    api('/agent/audit/verify').then(function (result) {
      window.alert(
        'Chain: ' + (result.chain.valid ? 'intact' : 'BROKEN') + ' over ' + result.chain.length + ' entries.\\n\\n' +
        result.supervision.statement + '\\n' +
        'Result: ' + (result.supervision.holds ? 'holds' : 'BREACHED (' + result.supervision.violations.length + ')')
      );
    });
  });

  document.addEventListener('click', function (event) {
    var target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset.fill) { $('prompt').value = target.dataset.fill; $('prompt').focus(); }
    if (target.dataset.approve) approve(target.dataset.approve, target.dataset.digest);
    if (target.dataset.reject) decline(target.dataset.reject);
    if (target.dataset.execute) raise(target.dataset.execute);
  });

  $('prompt').addEventListener('keydown', function (event) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') ask();
  });

  refresh();
})();
</script>
</body>
</html>`;
}
