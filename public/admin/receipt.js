"use strict";
(async () => {
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const out = document.getElementById("out");
  document.getElementById("printBtn").onclick = () => window.print();
  const id = new URLSearchParams(location.search).get("id");
  if (!/^\d+$/.test(id || "")) { out.innerHTML = `<p class="err">No receipt selected.</p>`; return; }
  let j;
  try {
    const r = await fetch("/admin/api/payments/" + id, { credentials: "same-origin", headers: { "x-requested-with": "dr-admin" } });
    if (r.status === 401) { location.href = "/admin"; return; }
    j = await r.json(); if (!r.ok || j.ok === false) throw new Error(j.error || "Receipt not found");
  } catch (e) { out.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  const p = j.payment, c = j.company || {}, cu = p.customer || {}, l = j.license;
  const inr = n => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const date = t => new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  const len = d => d % 30 === 0 ? (d / 30 === 1 ? "1 month" : d / 30 + " months") : d + " days";
  document.title = `Receipt ${p.receiptNo} · ${c.name || "Dodail Solutions"}`;

  // Amount in words, Indian numbering (lakh / crore)
  function words(n) {
    const a = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
    const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
    const two = x => x < 20 ? a[x] : b[Math.floor(x / 10)] + (x % 10 ? " " + a[x % 10] : "");
    const three = x => (x >= 100 ? a[Math.floor(x / 100)] + " Hundred" + (x % 100 ? " " : "") : "") + (x % 100 ? two(x % 100) : "");
    n = Math.floor(n); if (!n) return "Zero";
    const parts = [], cr = Math.floor(n / 1e7), lk = Math.floor(n / 1e5) % 100, th = Math.floor(n / 1e3) % 100, rest = n % 1000;
    if (cr) parts.push(three(cr) + " Crore"); if (lk) parts.push(two(lk) + " Lakh"); if (th) parts.push(two(th) + " Thousand"); if (rest) parts.push(three(rest));
    return parts.join(" ");
  }
  const period = l && l.expiresAt ? `Valid until ${date(l.expiresAt)}` : `${len(p.days)} from activation`;
  out.innerHTML = `<article class="sheet">
    <header class="top">
      <div class="co"><img src="/admin/logo.png" alt=""><div><b>${esc(c.name)}</b><small>${esc(c.address)}</small>${c.gstin ? `<small>GSTIN: ${esc(c.gstin)}</small>` : ""}<small>${esc([c.email, c.phone].filter(Boolean).join(" · "))}</small>${c.website ? `<small>${esc(c.website)}</small>` : ""}</div></div>
      <div class="meta"><h1>PAYMENT RECEIPT</h1><small>Receipt no.</small><b class="mono">${esc(p.receiptNo)}</b><small class="mt6">Date</small><b>${esc(date(p.paidAt))}</b></div>
    </header>
    <section class="two">
      <div><h3>Received from</h3><b>${esc(cu.business || cu.name || "Customer")}</b>${cu.business && cu.name ? `<div>${esc(cu.name)}</div>` : ""}${cu.city ? `<div>${esc(cu.city)}</div>` : ""}${cu.phone ? `<div>${esc(cu.phone)}</div>` : ""}${cu.email ? `<div>${esc(cu.email)}</div>` : ""}</div>
      <div><h3>Payment</h3><div>Method: <b>${esc(p.method || "—")}</b></div>${p.reference ? `<div>Reference: <span class="mono">${esc(p.reference)}</span></div>` : ""}<div>License key: <span class="mono">${esc(p.key)}</span></div><span class="paid">PAID</span></div>
    </section>
    <table><thead><tr><th>Description</th><th>Period</th><th class="r">Amount</th></tr></thead>
      <tbody><tr><td><b>Dodail Reach – ${esc(p.planName || "License")}</b><br><small class="dim">WhatsApp Web CRM software license for one computer${p.note ? " · " + esc(p.note) : ""}</small></td><td>${esc(len(p.days))}<br><small class="dim">${esc(period)}</small></td><td class="r">${inr(p.amount)}</td></tr></tbody></table>
    <div class="tot"><div><p><span>Subtotal</span><span>${inr(p.amount)}</span></p><p class="big"><span>Total received</span><span>${inr(p.amount)}</span></p></div></div>
    <p class="words">Rupees ${esc(words(p.amount))} only</p>
    <footer class="foot"><span>${esc(c.footer || "Thank you for your business.")}</span><span>Recorded by ${esc(p.actor || "Dodail Solutions")} · computer-generated receipt, no signature required.</span></footer>
  </article>`;
})();
