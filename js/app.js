// ============================================================
// Magnus — Caisse (version web, Firebase)
// Reprend à l'identique les fonctionnalités de l'application
// de bureau d'origine (Tkinter) : sélection de serveur, PIN,
// vente par catégories, panier, ticket PDF, historique,
// administration (serveurs, catégories, produits, commerçant,
// réglages), export CSV.
// ============================================================

const DEFAULT_CONFIG = {
  members: [
    { id: "m1", name: "Alex", pin: "" },
    { id: "m2", name: "Sam", pin: "" }
  ],
  categories: ["Boissons Chaudes", "Boissons Froides", "Snacks"],
  products: [
    { id: "p1", name: "Café", price: 0.30, emoji: "☕", image: "", category: "Boissons Chaudes" },
    { id: "p2", name: "Thé", price: 0.30, emoji: "🍵", image: "", category: "Boissons Chaudes" },
    { id: "p3", name: "Chocolat chaud", price: 0.40, emoji: "🍫", image: "", category: "Boissons Chaudes" }
  ],
  adminPin: "1234",
  currency: "CHF",
  autoDownloadTickets: true,
  merchant: {
    name: "Mon Café Sàrl",
    street: "Rue de la Gare 12",
    zip_city: "1000 Lausanne",
    phone: "+41 21 000 00 00",
    ide: "CHE-123.456.789 TVA",
    vat_rate: 2.6
  }
};

// ------------------------------------------------------------
// État global
// ------------------------------------------------------------
const state = {
  config: null,
  orders: [],
  screen: "loading",       // loading | select | memberPin | tap | history | adminPin | admin
  member: null,
  pendingMember: null,
  cart: {},
  selectedCategory: "Toutes",
  adminTab: "log",
  logFrom: daysAgoIso(30),
  logTo: todayIso(),
  logMemberId: "all",
  confirmReset: false,
  pinBuffer: "",
  errMsg: ""
};

// ------------------------------------------------------------
// Utilitaires
// ------------------------------------------------------------
function uid() {
  return Math.random().toString(16).slice(2, 12) + Date.now().toString(16).slice(-4);
}
function fmtMoney(v, currency) {
  const n = Number(v);
  return `${(isNaN(n) ? 0 : n).toFixed(2)} ${currency}`;
}
function nowTs() { return Date.now(); }
function fmtTs(tsMs) {
  const d = new Date(tsMs);
  const p = n => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function todayIso() { return new Date().toISOString().slice(0, 10); }
function daysAgoIso(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function isoToTsStart(iso) { return new Date(iso + "T00:00:00").getTime(); }
function isoToTsEnd(iso) { return new Date(iso + "T23:59:59").getTime(); }
function itemsSummary(items) {
  return items.map(it => `${it.qty}x ${it.productName}`).join(", ");
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function toast(text) {
  const el = document.getElementById("toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2200);
}

// ------------------------------------------------------------
// Accès Firestore
// ------------------------------------------------------------
const configRef = db.collection("config").doc("main");
const ordersRef = db.collection("orders");

function saveConfig() {
  return configRef.set(state.config);
}
function saveOrder(order) {
  return ordersRef.doc(order.id).set(order);
}
function deleteAllOrders() {
  return ordersRef.get().then(snap => {
    const batch = db.batch();
    snap.forEach(doc => batch.delete(doc.ref));
    return batch.commit();
  });
}

function init() {
  configRef.onSnapshot(async snap => {
    if (!snap.exists) {
      await configRef.set(DEFAULT_CONFIG);
      return;
    }
    state.config = snap.data();
    if (!state.config.categories) state.config.categories = ["Général"];
    if (!state.config.merchant) state.config.merchant = DEFAULT_CONFIG.merchant;
    if (state.screen === "loading") state.screen = "select";
    render();
  }, err => {
    document.getElementById("app").innerHTML =
      `<div class="center-box"><div class="lock-emoji">⚠️</div>
       <div class="bold">Connexion à Firebase impossible</div>
       <div class="dim small" style="margin-top:8px;">${escapeHtml(err.message)}</div>
       <div class="dim small" style="margin-top:8px;">Vérifiez js/firebase-config.js et les règles Firestore.</div></div>`;
  });

  ordersRef.orderBy("ts", "desc").onSnapshot(snap => {
    state.orders = snap.docs.map(d => d.data());
    render();
  });
}

// ------------------------------------------------------------
// Helpers config
// ------------------------------------------------------------
function currency() { return state.config?.currency || "CHF"; }
function members() { return state.config?.members || []; }
function products() { return state.config?.products || []; }
function categories() { return state.config?.categories || ["Général"]; }
function merchant() { return state.config?.merchant || {}; }

// ------------------------------------------------------------
// Génération du ticket PDF (jsPDF) — reprend la mise en page d'origine
// ------------------------------------------------------------
function dashedLine(doc, x1, y, x2) {
  doc.setLineDashPattern([1, 2], 0);
  doc.line(x1, y, x2, y);
  doc.setLineDashPattern([], 0);
}

function generateTicketPDF(order) {
  const { jsPDF } = window.jspdf;
  const m = merchant();
  const vatRate = parseFloat(m.vat_rate);
  const vat = isNaN(vatRate) ? 2.6 : vatRate;

  const lineH = 5.2;
  const heightMM = 85 + order.items.length * lineH;
  const widthMM = 80;
  const doc = new jsPDF({ unit: "mm", format: [widthMM, heightMM] });

  const xLeft = 5, xRight = widthMM - 5, cx = widthMM / 2;
  let y = 8;

  doc.setFont("helvetica", "bold"); doc.setFontSize(12);
  doc.text(m.name || "Magnus", cx, y, { align: "center" }); y += 5;

  doc.setFont("helvetica", "normal"); doc.setFontSize(8);
  const infoLines = [
    m.street,
    m.zip_city,
    m.phone ? `Tél: ${m.phone}` : "",
    m.ide ? `IDE/TVA: ${m.ide}` : ""
  ].filter(Boolean);
  infoLines.forEach(l => { doc.text(l, cx, y, { align: "center" }); y += 4; });

  y += 2;
  dashedLine(doc, xLeft, y, xRight); y += 5;

  doc.setFontSize(8);
  doc.text(`N° commande: ${order.id}`, xLeft, y); y += 4;
  doc.text(`Date: ${fmtTs(order.ts)}`, xLeft, y); y += 4;
  doc.text(`Servi par: ${order.memberName}`, xLeft, y); y += 4;

  dashedLine(doc, xLeft, y, xRight); y += 5;

  doc.setFontSize(9);
  order.items.forEach(it => {
    const lineTotal = it.qty * it.price;
    doc.text(`${it.qty} x ${it.productName}`, xLeft, y);
    doc.text(fmtMoney(lineTotal, currency()), xRight, y, { align: "right" });
    y += lineH;
  });

  y -= 1;
  dashedLine(doc, xLeft, y, xRight); y += 6;

  const total = order.total;
  const vatAmount = total - (total / (1 + vat / 100));

  doc.setFont("helvetica", "bold"); doc.setFontSize(11);
  doc.text("TOTAL TTC", xLeft, y);
  doc.text(fmtMoney(total, currency()), xRight, y, { align: "right" });
  y += 6;

  doc.setFont("helvetica", "normal"); doc.setFontSize(8);
  doc.text(`Dont TVA (${vat.toFixed(1)}%) :`, xLeft, y);
  doc.text(fmtMoney(vatAmount, currency()), xRight, y, { align: "right" });
  y += 8;

  doc.setFont("helvetica", "italic");
  doc.text("Merci de votre visite et à bientôt !", cx, y, { align: "center" });

  const d = new Date(order.ts);
  const p = n => String(n).padStart(2, "0");
  const safeMember = (order.memberName || "membre").replace(/[^a-zA-Z0-9 _-]/g, "").trim() || "membre";
  const filename = `Ticket_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}_${safeMember}.pdf`;

  return { doc, filename };
}

// ------------------------------------------------------------
// Export CSV — reprend la structure d'origine (4 sections, ';', BOM)
// ------------------------------------------------------------
function exportCsv(fromIso, toIso, memberFilterId) {
  const fromTs = isoToTsStart(fromIso);
  const toTs = isoToTsEnd(toIso);
  const filtered = state.orders
    .filter(o => o.ts >= fromTs && o.ts <= toTs && (memberFilterId === "all" || o.memberId === memberFilterId))
    .sort((a, b) => b.ts - a.ts);

  const rows = [];
  const q = v => `"${String(v).replace(/"/g, '""')}"`;
  const pushRow = arr => rows.push(arr.map(q).join(";"));

  rows.push([`=== Commandes (groupées) ===`].map(q).join(";"));
  pushRow(["Date", "Serveur", "Articles", "Nb articles", "Total", "Devise"]);
  let grandTotal = 0, grandCount = 0;
  filtered.forEach(o => {
    const nb = o.items.reduce((s, it) => s + it.qty, 0);
    grandTotal += o.total; grandCount += nb;
    pushRow([fmtTs(o.ts), o.memberName, itemsSummary(o.items), nb, o.total.toFixed(2), currency()]);
  });
  pushRow(["TOTAL", "", "", grandCount, grandTotal.toFixed(2), currency()]);
  rows.push("");

  rows.push([`=== Détail par article ===`].map(q).join(";"));
  pushRow(["Date", "Commande", "Serveur", "Produit", "Quantité", "Prix unitaire", "Total ligne", "Devise"]);
  filtered.forEach(o => {
    o.items.forEach(it => {
      pushRow([fmtTs(o.ts), o.id, o.memberName, it.productName, it.qty, it.price.toFixed(2), (it.qty * it.price).toFixed(2), currency()]);
    });
  });
  rows.push("");

  const byMember = {};
  filtered.forEach(o => {
    const e = byMember[o.memberId] || (byMember[o.memberId] = { name: o.memberName, orders: 0, items: 0, total: 0 });
    e.orders++; e.items += o.items.reduce((s, it) => s + it.qty, 0); e.total += o.total;
  });
  rows.push([`=== Récapitulatif par serveur ===`].map(q).join(";"));
  pushRow(["Serveur", "Nb commandes", "Nb articles", "Total"]);
  Object.values(byMember).sort((a, b) => b.total - a.total).forEach(e => {
    pushRow([e.name, e.orders, e.items, e.total.toFixed(2)]);
  });
  pushRow(["TOTAL", filtered.length, grandCount, grandTotal.toFixed(2)]);
  rows.push("");

  const byProduct = {};
  filtered.forEach(o => {
    o.items.forEach(it => {
      const e = byProduct[it.productName] || (byProduct[it.productName] = { count: 0, total: 0 });
      e.count += it.qty; e.total += it.qty * it.price;
    });
  });
  rows.push([`=== Récapitulatif par produit ===`].map(q).join(";"));
  pushRow(["Produit", "Nombre vendu", "Total"]);
  Object.entries(byProduct).sort((a, b) => b[1].total - a[1].total).forEach(([name, e]) => {
    pushRow([name, e.count, e.total.toFixed(2)]);
  });

  const csvContent = "\ufeff" + rows.join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cafe_${fromIso}_${toIso}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return filtered.length;
}

// ------------------------------------------------------------
// Image produit : pas de Firebase Storage (plan gratuit) → on
// redimensionne l'image côté navigateur et on la stocke directement
// dans Firestore sous forme de petite image base64 (data URI).
// ------------------------------------------------------------
const PRODUCT_IMAGE_MAX_SIZE = 160; // px, côté le plus grand
const PRODUCT_IMAGE_QUALITY = 0.72; // qualité JPEG

function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = e => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

async function compressImageToDataURL(file) {
  const img = await fileToImage(file);
  let { width, height } = img;
  const scale = Math.min(1, PRODUCT_IMAGE_MAX_SIZE / Math.max(width, height));
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  return canvas.toDataURL("image/jpeg", PRODUCT_IMAGE_QUALITY);
}

async function uploadProductImage(file) {
  if (!file) return "";
  // Garde-fou : refuse un fichier trop lourd avant même de le traiter
  if (file.size > 8 * 1024 * 1024) {
    throw new Error("Image trop lourde (max ~8 Mo).");
  }
  return await compressImageToDataURL(file);
}

// ------------------------------------------------------------
// Rendu — routeur principal
// ------------------------------------------------------------
function render() {
  const app = document.getElementById("app");
  if (!state.config) { app.innerHTML = "Chargement…"; return; }

  let html = "";
  switch (state.screen) {
    case "select": html = renderSelect(); break;
    case "memberPin": html = renderMemberPin(); break;
    case "tap": html = renderTap(); break;
    case "history": html = renderHistory(); break;
    case "adminPin": html = renderAdminPin(); break;
    case "admin": html = renderAdmin(); break;
    default: html = "Chargement…";
  }
  app.innerHTML = html;
  bindEvents();
  const autofocus = app.querySelector("[data-autofocus]");
  if (autofocus) autofocus.focus();
}

function header(subtitle) {
  return `
    <div class="header-row">
      <div class="left">
        <div>☕ Magnus</div>
        <div class="dim small">${escapeHtml(subtitle)}</div>
      </div>
      <button class="btn-icon" data-action="go-admin-pin">🔒</button>
    </div>`;
}

// ------------------------------------------------------------
// Écran : sélection du serveur
// ------------------------------------------------------------
function renderSelect() {
  const mem = members();
  const grid = mem.length
    ? `<div class="grid-2">${mem.map(m => `<button class="member-btn" data-action="select-member" data-id="${m.id}">${escapeHtml(m.name)}</button>`).join("")}</div>`
    : `<div class="empty-note">Aucun serveur. Ajoutez-en depuis l'administration.</div>`;
  return `
    <div>
      ${header("Quel serveur s'occupe de la vente ?")}
      ${grid}
    </div>`;
}

// ------------------------------------------------------------
// Écran : code personnel
// ------------------------------------------------------------
function renderMemberPin() {
  const m = state.pendingMember;
  return `
    <div>
      <button class="btn-link back-btn" data-action="back-select">← Changer de personne</button>
      <div class="center-box">
        <div class="lock-emoji">🔒</div>
        <div class="title-sm">${escapeHtml(m.name)}</div>
        <div class="dim small" style="margin:6px 0;">Entrez votre code personnel</div>
        <input data-autofocus type="password" inputmode="numeric" id="pinInput" style="width:120px;text-align:center;font-size:18px;letter-spacing:4px;" value="${escapeHtml(state.pinBuffer)}">
        ${state.errMsg ? `<div class="red small" style="margin-top:8px;">${escapeHtml(state.errMsg)}</div>` : ""}
      </div>
    </div>`;
}

// ------------------------------------------------------------
// Écran : vente (catégories + panier)
// ------------------------------------------------------------
function renderTap() {
  const cats = ["Toutes", ...categories()];
  if (!cats.includes(state.selectedCategory)) state.selectedCategory = "Toutes";

  const catChips = cats.map(c => `
    <button class="cat-chip ${c === state.selectedCategory ? "active" : ""}" data-action="set-category" data-id="${escapeHtml(c)}">${escapeHtml(c)}</button>
  `).join("");

  let prods = products();
  if (state.selectedCategory !== "Toutes") prods = prods.filter(p => p.category === state.selectedCategory);

  const cells = prods.length ? prods.map(p => {
    const qty = state.cart[p.id] || 0;
    const emoji = (p.emoji || "").trim();
    const img = p.image ? `<img src="${p.image}" alt="">` : (emoji ? `<div class="emoji">${emoji}</div>` : "");
    return `
      <button class="product-cell ${qty > 0 ? "active" : ""}" data-action="add-to-cart" data-id="${p.id}">
        ${img}
        <div>${escapeHtml(p.name)}</div>
        <div class="dim small">${fmtMoney(p.price, currency())}</div>
        ${qty > 0 ? `<div class="qty-badge">(x${qty})</div>` : ""}
      </button>`;
  }).join("") : `<div class="empty-note">Aucun produit dans cette catégorie.</div>`;

  return `
    <div style="display:flex;flex-direction:column;height:100%;">
      <div class="header-row" style="margin-bottom:4px;">
        <button class="btn-link" data-action="back-select">← Changer de personne</button>
        <button class="btn-link" data-action="go-history">Mon historique →</button>
      </div>
      <div class="dim small" style="margin-top:6px;">Bonjour</div>
      <div class="title">${escapeHtml(state.member.name)}</div>

      <div class="cat-scroll">${catChips}</div>

      <div class="scroll-area">
        <div class="product-grid">${cells}</div>
      </div>

      <div class="cart-panel">${renderCartPanel()}</div>
    </div>`;
}

function renderCartPanel() {
  const pmap = Object.fromEntries(products().map(p => [p.id, p]));
  const lines = Object.entries(state.cart)
    .filter(([pid, qty]) => qty > 0 && pmap[pid])
    .map(([pid, qty]) => [pmap[pid], qty]);

  const count = lines.reduce((s, [, q]) => s + q, 0);
  let html = `<div class="divider"></div>`;
  html += `<div class="dim small">${lines.length ? `Votre sélection (${count})` : "Votre sélection"}</div>`;

  if (!lines.length) {
    html += `<div class="dim small" style="margin-top:6px;">Rien pour l'instant.</div>`;
    return html;
  }

  html += lines.map(([p, qty]) => {
    const emoji = (p.emoji || "").trim();
    const display = emoji ? `${emoji} ${escapeHtml(p.name)}` : escapeHtml(p.name);
    const img = p.image ? `<img src="${p.image}" alt="">` : "";
    return `
      <div class="cart-line">
        <div class="info">${img}<span>${display}</span></div>
        <div class="cart-ctrl">
          <button class="qty-btn" data-action="dec-cart" data-id="${p.id}">−</button>
          <span>${qty}</span>
          <button class="qty-btn" data-action="add-to-cart" data-id="${p.id}">+</button>
          <button class="trash-btn" data-action="remove-cart" data-id="${p.id}">🗑</button>
        </div>
      </div>`;
  }).join("");

  const total = lines.reduce((s, [p, q]) => s + p.price * q, 0);
  html += `
    <div class="cart-total">
      <span class="dim">Total</span>
      <span class="amount">${fmtMoney(total, currency())}</span>
    </div>
    <button class="btn btn-block" data-action="validate-cart">✓ Valider ma sélection</button>`;
  return html;
}

// ------------------------------------------------------------
// Écran : historique personnel
// ------------------------------------------------------------
function renderHistory() {
  const myOrders = state.orders.filter(o => o.memberId === state.member.id);
  const total = myOrders.reduce((s, o) => s + o.total, 0);
  const rows = myOrders.length ? myOrders.map(o => `
    <div class="hist-row">
      <div class="hist-top">
        <div>
          <div class="small">${escapeHtml(itemsSummary(o.items))}</div>
          <div class="dim tiny">${fmtTs(o.ts)}</div>
        </div>
        <div class="amber small">${fmtMoney(o.total, currency())}</div>
      </div>
    </div>`).join("") : `<div class="empty-note">Aucune commande enregistrée pour l'instant.</div>`;

  return `
    <div>
      <button class="btn-link back-btn" data-action="go-tap">← Retour</button>
      <div class="dim small">Ventes de</div>
      <div class="title-sm" style="margin-bottom:10px;">${escapeHtml(state.member.name)}</div>
      <div class="summary-box">
        <span class="dim small">${myOrders.length} commande${myOrders.length > 1 ? "s" : ""} au total</span>
        <span class="amber bold">${fmtMoney(total, currency())}</span>
      </div>
      <div class="scroll-area">${rows}</div>
    </div>`;
}

// ------------------------------------------------------------
// Écran : code admin
// ------------------------------------------------------------
function renderAdminPin() {
  return `
    <div>
      <button class="btn-link back-btn" data-action="back-select">← Retour</button>
      <div class="center-box">
        <div class="lock-emoji">🔒</div>
        <div class="bold" style="margin-bottom:10px;">Accès administrateur</div>
        <input data-autofocus type="password" id="adminPinInput" style="width:120px;text-align:center;font-size:18px;letter-spacing:4px;" value="${escapeHtml(state.pinBuffer)}">
        ${state.errMsg ? `<div class="red small" style="margin-top:6px;">${escapeHtml(state.errMsg)}</div>` : ""}
        <button class="btn" style="margin-top:10px;" data-action="unlock-admin">Déverrouiller</button>
      </div>
    </div>`;
}

// ------------------------------------------------------------
// Écran : administration
// ------------------------------------------------------------
function renderAdmin() {
  const tabs = [
    ["log", "Commandes"], ["members", "Serveurs"], ["categories", "Catégories"],
    ["products", "Produits"], ["merchant", "Commerçant"], ["settings", "Réglages"]
  ];
  const tabsHtml = tabs.map(([key, label]) => `
    <button class="tab-btn ${state.adminTab === key ? "active" : ""}" data-action="set-admin-tab" data-id="${key}">${label}</button>
  `).join("");

  let body = "";
  switch (state.adminTab) {
    case "log": body = renderAdminLog(); break;
    case "members": body = renderAdminMembers(); break;
    case "categories": body = renderAdminCategories(); break;
    case "products": body = renderAdminProducts(); break;
    case "merchant": body = renderAdminMerchant(); break;
    case "settings": body = renderAdminSettings(); break;
  }

  return `
    <div style="display:flex;flex-direction:column;height:100%;">
      <button class="btn-link back-btn" data-action="back-select">← Quitter l'administration</button>
      <div class="tabs">${tabsHtml}</div>
      <div class="scroll-area">${body}</div>
    </div>`;
}

function renderAdminLog() {
  const memberOptions = [`<option value="all" ${state.logMemberId === "all" ? "selected" : ""}>Tous</option>`]
    .concat(members().map(m => `<option value="${m.id}" ${state.logMemberId === m.id ? "selected" : ""}>${escapeHtml(m.name)}</option>`))
    .join("");

  let fromTs, toTs;
  try { fromTs = isoToTsStart(state.logFrom); toTs = isoToTsEnd(state.logTo); }
  catch { fromTs = 0; toTs = Infinity; }

  const filtered = state.orders
    .filter(o => o.ts >= fromTs && o.ts <= toTs && (state.logMemberId === "all" || o.memberId === state.logMemberId))
    .sort((a, b) => b.ts - a.ts);
  const grandTotal = filtered.reduce((s, o) => s + o.total, 0);

  const rows = filtered.length ? filtered.map(o => `
    <div class="admin-row" style="flex-direction:column;align-items:stretch;">
      <div style="display:flex;justify-content:space-between;">
        <span class="small">Servi par ${escapeHtml(o.memberName)} — ${escapeHtml(itemsSummary(o.items))}</span>
        <span class="amber small">${fmtMoney(o.total, currency())}</span>
      </div>
      <div class="dim tiny">${fmtTs(o.ts)}</div>
    </div>`).join("") : `<div class="empty-note">Aucune commande sur cette période.</div>`;

  return `
    <div class="form-row">
      <div><label class="dim tiny">Du</label><input type="date" id="logFrom" value="${state.logFrom}"></div>
      <div><label class="dim tiny">Au</label><input type="date" id="logTo" value="${state.logTo}"></div>
      <div><label class="dim tiny">Serveur</label><select id="logMember">${memberOptions}</select></div>
    </div>
    <div class="form-row">
      <button class="btn-ghost" data-action="filter-log">Filtrer</button>
      <button class="btn" data-action="export-csv">⬇ Exporter CSV</button>
    </div>
    <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
      <span class="dim small">${filtered.length} commande(s)</span>
      <span class="amber bold">${fmtMoney(grandTotal, currency())}</span>
    </div>
    ${rows}`;
}

function renderAdminMembers() {
  const rows = members().map(m => `
    <div class="admin-row">
      <span class="name">${escapeHtml(m.name)}</span>
      <input class="pin-input" data-action="save-member-pin" data-id="${m.id}" style="width:80px;text-align:center;" value="${escapeHtml(m.pin || "")}" placeholder="code">
      <button class="trash-btn" data-action="delete-member" data-id="${m.id}">🗑</button>
    </div>`).join("");

  return `
    <div class="form-row">
      <input id="newMemberName" placeholder="Nom du serveur">
      <button class="btn-ghost" data-action="add-member">+ Ajouter</button>
    </div>
    ${rows}
    <div class="hint">Le champ à droite de chaque serveur est son code personnel optionnel.</div>`;
}

function renderAdminCategories() {
  const rows = categories().map(c => `
    <div class="admin-row">
      <span class="name">${escapeHtml(c)}</span>
      <button class="trash-btn" data-action="delete-category" data-id="${escapeHtml(c)}">🗑</button>
    </div>`).join("");

  return `
    <div class="form-row">
      <input id="newCatName" placeholder="Nouvelle catégorie">
      <button class="btn-ghost" data-action="add-category">+ Ajouter catégorie</button>
    </div>
    ${rows}`;
}

function renderAdminProducts() {
  const catOptions = categories().map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");

  const rows = products().map(p => {
    const img = p.image ? `<img src="${p.image}" alt="">` : "";
    const catOpts = categories().map(c => `<option value="${escapeHtml(c)}" ${p.category === c ? "selected" : ""}>${escapeHtml(c)}</option>`).join("");
    return `
      <div class="admin-row">
        ${img}
        <label class="file-label" style="padding:4px 6px;">📷<input type="file" accept="image/*" data-action="change-product-image" data-id="${p.id}"></label>
        <input data-action="save-product-emoji" data-id="${p.id}" style="width:34px;text-align:center;" value="${escapeHtml(p.emoji || "")}">
        <span class="name">${escapeHtml(p.name)}</span>
        <input data-action="save-product-price" data-id="${p.id}" style="width:60px;text-align:center;" value="${p.price.toFixed(2)}">
        <select data-action="save-product-category" data-id="${p.id}">${catOpts}</select>
        <button class="trash-btn" data-action="delete-product" data-id="${p.id}">🗑</button>
      </div>`;
  }).join("");

  return `
    <div class="form-row">
      <label class="file-label">📷 image<input type="file" accept="image/*" id="newProdImage"></label>
      <input id="newProdEmoji" placeholder="emoji" style="width:60px;">
      <input id="newProdName" placeholder="Nom">
      <input id="newProdPrice" placeholder="Prix" style="width:70px;">
      <select id="newProdCat">${catOptions}</select>
      <button class="btn-ghost" data-action="add-product">+</button>
    </div>
    ${rows}`;
}

function renderAdminMerchant() {
  const m = merchant();
  const field = (id, label, value, hint) => `
    <label class="field-label">${label}</label>
    <input id="${id}" value="${escapeHtml(value || "")}">
    ${hint ? `<div class="hint">${hint}</div>` : ""}`;

  return `
    <div class="title-sm amber" style="margin-bottom:6px;">Profil Commerçant (Information ticket)</div>
    ${field("m_name", "Nom de l'entreprise / Établissement *", m.name)}
    ${field("m_street", "Adresse / Rue", m.street)}
    ${field("m_zip", "NPA & Localité", m.zip_city)}
    ${field("m_phone", "Téléphone", m.phone)}
    ${field("m_ide", "Numéro IDE / TVA Suisse", m.ide, "Ex: CHE-123.456.789 TVA")}
    ${field("m_vat", "Taux de TVA (%)", m.vat_rate, "Taux suisse standard (8.1%) ou réduit (2.6%)")}
    <button class="btn" style="margin-top:14px;" data-action="save-merchant">Enregistrer les informations</button>`;
}

function renderAdminSettings() {
  const autoDownload = state.config.autoDownloadTickets !== false;
  return `
    <label class="field-label">Code PIN administrateur</label>
    <div class="form-row">
      <input id="adminPinField" value="${escapeHtml(state.config.adminPin || "1234")}" style="width:100px;">
      <button class="btn-ghost" data-action="save-admin-pin">Enregistrer</button>
    </div>

    <label class="field-label">Devise</label>
    <select id="currencyField" data-action="save-currency" style="width:100px;">
      ${["CHF", "EUR", "USD"].map(c => `<option value="${c}" ${currency() === c ? "selected" : ""}>${c}</option>`).join("")}
    </select>

    <label class="field-label">Ticket PDF</label>
    <label style="display:flex;align-items:center;gap:8px;">
      <input type="checkbox" id="autoDownloadField" data-action="save-auto-download" ${autoDownload ? "checked" : ""} style="width:auto;">
      <span class="small">Télécharger automatiquement le ticket PDF à chaque vente</span>
    </label>
    <div class="hint">Contrairement à l'application de bureau, un navigateur ne permet pas de choisir un dossier fixe : chaque ticket est téléchargé via le dossier de téléchargement habituel de votre navigateur.</div>

    <div class="red bold" style="margin-top:18px;margin-bottom:6px;">Zone sensible</div>
    ${state.confirmReset ? `
      <div class="dim small" style="margin-bottom:6px;">Confirmer la suppression définitive ?</div>
      <button class="btn-danger" data-action="confirm-reset">Oui, supprimer</button>
      <button class="btn-ghost" data-action="cancel-reset">Annuler</button>
    ` : `<button class="btn-danger" data-action="ask-reset">↺ Réinitialiser tout l'historique</button>`}`;
}

// ------------------------------------------------------------
// Actions
// ------------------------------------------------------------
async function addToCart(pid) {
  state.cart[pid] = (state.cart[pid] || 0) + 1;
  render();
}
function decFromCart(pid) {
  const q = (state.cart[pid] || 0) - 1;
  if (q <= 0) delete state.cart[pid]; else state.cart[pid] = q;
  render();
}
function removeFromCart(pid) {
  delete state.cart[pid];
  render();
}

async function validateCart() {
  const pmap = Object.fromEntries(products().map(p => [p.id, p]));
  const lines = Object.entries(state.cart).filter(([pid, qty]) => qty > 0 && pmap[pid]);
  if (!lines.length || !state.member) return;

  const items = lines.map(([pid, qty]) => {
    const p = pmap[pid];
    return { productId: p.id, productName: p.name, qty, price: p.price };
  });
  const total = items.reduce((s, it) => s + it.qty * it.price, 0);
  const order = {
    id: uid(),
    ts: nowTs(),
    memberId: state.member.id,
    memberName: state.member.name,
    items,
    total
  };

  try {
    await saveOrder(order);
  } catch (e) {
    toast("Erreur : commande non enregistrée (" + e.message + ")");
    return;
  }

  let ticketOk = false;
  if (state.config.autoDownloadTickets !== false) {
    try {
      const { doc, filename } = generateTicketPDF(order);
      doc.save(filename);
      ticketOk = true;
    } catch (e) {
      console.error("Erreur génération ticket PDF", e);
    }
  }

  const count = items.reduce((s, it) => s + it.qty, 0);
  let msg = `${count} article${count > 1 ? "s" : ""} vendu${count > 1 ? "s" : ""} — servi par ${state.member.name}`;
  if (ticketOk) msg += " · ticket téléchargé";
  toast(msg);

  state.cart = {};
  render();
}

function bindEvents() {
  const app = document.getElementById("app");

  app.onclick = async e => {
    const t = e.target.closest("[data-action]");
    if (!t) return;
    const action = t.dataset.action;
    const id = t.dataset.id;

    switch (action) {
      case "select-member": selectMember(id); break;
      case "back-select": state.screen = "select"; state.errMsg = ""; state.pinBuffer = ""; render(); break;
      case "go-admin-pin": state.screen = "adminPin"; state.errMsg = ""; state.pinBuffer = ""; render(); break;
      case "go-history": state.screen = "history"; render(); break;
      case "go-tap": state.screen = "tap"; render(); break;
      case "add-to-cart": addToCart(id); break;
      case "dec-cart": decFromCart(id); break;
      case "remove-cart": removeFromCart(id); break;
      case "validate-cart": validateCart(); break;
      case "set-category": state.selectedCategory = id; render(); break;
      case "unlock-admin": unlockAdmin(); break;
      case "set-admin-tab": state.adminTab = id; render(); break;
      case "filter-log": filterLog(); break;
      case "export-csv": doExportCsv(); break;
      case "add-member": addMember(); break;
      case "delete-member": deleteMember(id); break;
      case "add-category": addCategory(); break;
      case "delete-category": deleteCategory(id); break;
      case "add-product": addProduct(); break;
      case "delete-product": deleteProduct(id); break;
      case "save-merchant": saveMerchant(); break;
      case "save-admin-pin": saveAdminPin(); break;
      case "save-auto-download": saveAutoDownload(t.checked); break;
      case "ask-reset": state.confirmReset = true; render(); break;
      case "cancel-reset": state.confirmReset = false; render(); break;
      case "confirm-reset": await doReset(); break;
    }
  };

  app.onchange = async e => {
    const t = e.target.closest("[data-action]");
    if (!t) return;
    const action = t.dataset.action;
    const id = t.dataset.id;
    switch (action) {
      case "save-member-pin": saveMemberPin(id, t.value.trim()); break;
      case "save-product-emoji": saveProductField(id, "emoji", t.value.trim()); break;
      case "save-product-price": saveProductPrice(id, t.value); break;
      case "save-product-category": saveProductField(id, "category", t.value); break;
      case "change-product-image": await changeProductImage(id, t.files[0]); break;
      case "currencyField": break;
      case "save-currency": saveCurrency(t.value); break;
    }
  };
  const curField = document.getElementById("currencyField");
  if (curField) curField.onchange = () => saveCurrency(curField.value);
  const autoDl = document.getElementById("autoDownloadField");
  if (autoDl) autoDl.onchange = () => saveAutoDownload(autoDl.checked);

  // PIN inputs
  const pinInput = document.getElementById("pinInput");
  if (pinInput) {
    pinInput.oninput = () => {
      state.pinBuffer = pinInput.value;
      tryUnlockMember();
    };
    pinInput.onkeydown = e => { if (e.key === "Enter") tryUnlockMember(); };
  }
  const adminPinInput = document.getElementById("adminPinInput");
  if (adminPinInput) {
    adminPinInput.oninput = () => { state.pinBuffer = adminPinInput.value; };
    adminPinInput.onkeydown = e => { if (e.key === "Enter") unlockAdmin(); };
  }
  const logFrom = document.getElementById("logFrom");
  const logTo = document.getElementById("logTo");
  const logMember = document.getElementById("logMember");
  if (logFrom) logFrom.onchange = () => { state.logFrom = logFrom.value; };
  if (logTo) logTo.onchange = () => { state.logTo = logTo.value; };
  if (logMember) logMember.onchange = () => { state.logMemberId = logMember.value; };
}

function selectMember(mid) {
  const m = members().find(x => x.id === mid);
  if (!m) return;
  if (m.pin) {
    state.pendingMember = m;
    state.pinBuffer = "";
    state.errMsg = "";
    state.screen = "memberPin";
  } else {
    state.member = m;
    state.cart = {};
    state.screen = "tap";
  }
  render();
}

function tryUnlockMember() {
  const m = state.pendingMember;
  if (!m) return;
  if (state.pinBuffer === (m.pin || "")) {
    state.member = m;
    state.pendingMember = null;
    state.cart = {};
    state.errMsg = "";
    state.pinBuffer = "";
    state.screen = "tap";
    render();
  } else if (state.pinBuffer.length >= (m.pin || "").length && state.pinBuffer) {
    state.errMsg = "Code incorrect";
    state.pinBuffer = "";
    render();
  }
}

function unlockAdmin() {
  if (state.pinBuffer === (state.config.adminPin || "1234")) {
    state.errMsg = "";
    state.pinBuffer = "";
    state.confirmReset = false;
    state.screen = "admin";
  } else {
    state.errMsg = "Code incorrect";
    state.pinBuffer = "";
  }
  render();
}

function filterLog() { render(); }

function doExportCsv() {
  const n = exportCsv(state.logFrom, state.logTo, state.logMemberId);
  toast(`${n} commande(s) exportée(s)`);
}

async function addMember() {
  const input = document.getElementById("newMemberName");
  const name = input.value.trim();
  if (!name) return;
  state.config.members = state.config.members || [];
  state.config.members.push({ id: uid(), name, pin: "" });
  await saveConfig();
}
async function deleteMember(mid) {
  state.config.members = members().filter(m => m.id !== mid);
  await saveConfig();
}
async function saveMemberPin(mid, pin) {
  const m = members().find(x => x.id === mid);
  if (m) m.pin = pin;
  await saveConfig();
}

async function addCategory() {
  const input = document.getElementById("newCatName");
  const name = input.value.trim();
  if (!name) return;
  state.config.categories = state.config.categories || [];
  if (!state.config.categories.includes(name)) {
    state.config.categories.push(name);
    await saveConfig();
  }
}
async function deleteCategory(cat) {
  const cats = categories();
  if (cats.length <= 1) { toast("Vous devez conserver au moins une catégorie."); return; }
  state.config.categories = cats.filter(c => c !== cat);
  const fallback = state.config.categories[0];
  products().forEach(p => { if (p.category === cat) p.category = fallback; });
  await saveConfig();
}

async function addProduct() {
  const name = document.getElementById("newProdName").value.trim();
  const priceRaw = document.getElementById("newProdPrice").value.replace(",", ".");
  const price = parseFloat(priceRaw);
  if (!name || isNaN(price)) { toast("Merci d'indiquer un nom et un prix valide (ex: 0.30)."); return; }
  const emoji = document.getElementById("newProdEmoji").value.trim();
  const cat = document.getElementById("newProdCat").value;
  const file = document.getElementById("newProdImage").files[0];

  let imageUrl = "";
  if (file) {
    toast("Envoi de l'image…");
    try { imageUrl = await uploadProductImage(file); } catch (e) { toast("Erreur d'envoi de l'image : " + e.message); }
  }

  state.config.products = state.config.products || [];
  state.config.products.push({ id: uid(), name, price, image: imageUrl, emoji, category: cat });
  await saveConfig();
}
async function deleteProduct(pid) {
  state.config.products = products().filter(p => p.id !== pid);
  await saveConfig();
}
async function saveProductField(pid, field, value) {
  const p = products().find(x => x.id === pid);
  if (p) p[field] = value;
  await saveConfig();
}
async function saveProductPrice(pid, raw) {
  const val = parseFloat(String(raw).replace(",", "."));
  if (isNaN(val)) return;
  const p = products().find(x => x.id === pid);
  if (p) p.price = val;
  await saveConfig();
}
async function changeProductImage(pid, file) {
  if (!file) return;
  toast("Envoi de l'image…");
  try {
    const url = await uploadProductImage(file);
    const p = products().find(x => x.id === pid);
    if (p) p.image = url;
    await saveConfig();
  } catch (e) {
    toast("Erreur d'envoi de l'image : " + e.message);
  }
}

async function saveMerchant() {
  const vatRaw = document.getElementById("m_vat").value.replace(",", ".");
  const vatVal = parseFloat(vatRaw);
  if (isNaN(vatVal)) { toast("Veuillez entrer un nombre valide pour la TVA."); return; }
  state.config.merchant = {
    name: document.getElementById("m_name").value.trim(),
    street: document.getElementById("m_street").value.trim(),
    zip_city: document.getElementById("m_zip").value.trim(),
    phone: document.getElementById("m_phone").value.trim(),
    ide: document.getElementById("m_ide").value.trim(),
    vat_rate: vatVal
  };
  await saveConfig();
  toast("Informations commerçant enregistrées");
}

async function saveAdminPin() {
  const val = document.getElementById("adminPinField").value;
  state.config.adminPin = val;
  await saveConfig();
  toast("Code administrateur enregistré");
}
async function saveCurrency(val) {
  state.config.currency = val;
  await saveConfig();
}
async function saveAutoDownload(checked) {
  state.config.autoDownloadTickets = checked;
  await saveConfig();
}

async function doReset() {
  await deleteAllOrders();
  state.confirmReset = false;
  render();
  toast("Historique des commandes supprimé");
}

// ------------------------------------------------------------
// Démarrage
// ------------------------------------------------------------
init();
