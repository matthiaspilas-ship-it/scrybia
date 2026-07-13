const $ = (id) => document.getElementById(id);

// --- Animation "machine à écrire" du titre ---
(function typewriter() {
  const el = $("headline");
  if (!el) return;
  // Respecte le réglage "réduire les animations" : on laisse le titre tel quel.
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  // Le titre, segment par segment (accent = true → mot en dégradé).
  const parts = [
    ["Des contenus qui ", false],
    ["convertissent", true],
    [",", false],
    ["\n", false],
    ["en quelques secondes.", false],
  ];
  const tokens = [];
  for (const [str, acc] of parts) for (const ch of str) tokens.push({ ch, acc });

  const render = (n, caret = true) => {
    let html = "";
    let inAcc = false;
    for (let i = 0; i < n; i++) {
      const { ch, acc } = tokens[i];
      if (acc && !inAcc) {
        html += '<span class="accent">';
        inAcc = true;
      }
      if (!acc && inAcc) {
        html += "</span>";
        inAcc = false;
      }
      html += ch === "\n" ? "<br>" : ch;
    }
    if (inAcc) html += "</span>";
    if (caret) html += '<span class="type-caret"></span>';
    el.innerHTML = html;
  };

  render(0);
  let n = 0;
  setTimeout(function tick() {
    n++;
    render(n);
    if (n < tokens.length) {
      // Petite pause plus longue à la virgule et au saut de ligne.
      const prev = tokens[n - 1].ch;
      const delay = prev === "," || prev === "\n" ? 260 : 42;
      setTimeout(tick, delay);
    } else {
      // Fin : on laisse le curseur clignoter un instant puis on le retire.
      setTimeout(() => render(tokens.length, false), 1400);
    }
  }, 350);
})();

// ============ Authentification (front) ============
const authModal = $("authModal");
const authForm = $("authForm");
const authEmail = $("authEmail");
const authPassword = $("authPassword");
const authError = $("authError");
const authSubmit = $("authSubmit");
const authTitle = $("authTitle");
const authLead = $("authLead");
const pwHint = $("pwHint");

let authMode = "login"; // "login" | "register"
let currentUser = null;
let usage = null; // { used, limit, remaining, subscribed }

const showAuthError = (msg) => {
  authError.textContent = msg;
  authError.hidden = false;
};
const hideAuthError = () => (authError.hidden = true);

function setAuthMode(mode) {
  authMode = mode;
  document
    .querySelectorAll(".auth-tab")
    .forEach((t) => t.classList.toggle("active", t.dataset.tab === mode));
  const isLogin = mode === "login";
  authTitle.textContent = isLogin ? "Bon retour 👋" : "Créer un compte";
  authLead.textContent = isLogin
    ? "Connectez-vous pour générer vos contenus."
    : "Gratuit, sans carte bancaire — prêt en quelques secondes.";
  authSubmit.textContent = isLogin ? "Se connecter" : "Créer mon compte";
  authPassword.autocomplete = isLogin ? "current-password" : "new-password";
  pwHint.hidden = isLogin;
  hideAuthError();
}

function openAuth(mode = "login") {
  setAuthMode(mode);
  authModal.hidden = false;
  document.body.style.overflow = "hidden";
  setTimeout(() => authEmail.focus(), 50);
}
function closeAuth() {
  authModal.hidden = true;
  document.body.style.overflow = "";
}

// Applique l'état connecté / déconnecté à la barre de navigation.
function setUser(user, nextUsage) {
  currentUser = user;
  if (user) $("userEmail").textContent = user.email;
  $("authIn").hidden = !user;
  $("authOut").hidden = !!user;
  if (nextUsage !== undefined) usage = nextUsage;
  renderUsage();
}

// Affiche le quota restant selon l'offre, sous le bouton de génération.
function renderUsage() {
  const line = $("usageLine");
  if (!currentUser || !usage) {
    line.hidden = true;
    return;
  }
  line.hidden = false;
  line.className = "usage-line";
  if (usage.unlimited) {
    line.innerHTML = "⭐ <strong>Pro</strong> — générations illimitées";
    line.classList.add("pro");
  } else if (usage.plan === "starter") {
    const r = usage.remaining;
    line.innerHTML = `⭐ <strong>Starter</strong> — <strong>${r}</strong>/${usage.limit} générations ce mois`;
    if (r <= 0) line.classList.add("empty");
  } else if (usage.remaining > 0) {
    const n = usage.remaining;
    line.innerHTML = `🎁 <strong>${n}</strong> génération${n > 1 ? "s" : ""} gratuite${
      n > 1 ? "s" : ""
    } restante${n > 1 ? "s" : ""}`;
  } else {
    line.innerHTML =
      'Générations gratuites épuisées — <button type="button" class="go-pro" id="goPro">voir les offres</button>';
    line.classList.add("empty");
  }
  const goPro = $("goPro");
  if (goPro) goPro.addEventListener("click", openPaywall);
}

// Récupère l'usage à jour depuis le serveur.
async function refreshUsage() {
  try {
    const d = await (await fetch("/api/auth/me")).json();
    usage = d.usage || null;
    renderUsage();
  } catch {
    /* silencieux */
  }
}

// Petite notification éphémère.
let toastTimer;
function showToast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  requestAnimationFrame(() => t.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => (t.hidden = true), 300);
  }, 4000);
}

// ---------- Paywall (offres d'abonnement) ----------
const paywall = $("paywallModal");
let cycle = "monthly"; // "monthly" | "annual"

const AMOUNTS = {
  monthly: { starter: "9,99 €", pro: "19,99 €", per: "/mois" },
  annual: { starter: "99 €", pro: "199 €", per: "/an" },
};

function renderCycle() {
  document
    .querySelectorAll(".cycle-btn")
    .forEach((b) => b.classList.toggle("active", b.dataset.cycle === cycle));
  const a = AMOUNTS[cycle];
  document.querySelector('[data-amount="starter"]').textContent = a.starter;
  document.querySelector('[data-amount="pro"]').textContent = a.pro;
  document.querySelectorAll("[data-per]").forEach((e) => (e.textContent = a.per));
}

function openPaywall() {
  const subscribed = usage && usage.subscribed;
  $("pwOffers").hidden = subscribed;
  $("pwActive").hidden = !subscribed;
  if (subscribed) {
    $("pwTitle").textContent = "Vous êtes abonné ✨";
    $("pwActive").textContent =
      usage.plan === "pro"
        ? "Offre Pro active — générations illimitées."
        : `Offre Starter active — ${usage.remaining}/${usage.limit} générations restantes ce mois.`;
  } else {
    $("pwTitle").textContent = "Choisissez votre offre 🚀";
    renderCycle();
  }
  $("paywallError").hidden = true;
  paywall.hidden = false;
  document.body.style.overflow = "hidden";
}

function closePaywall() {
  paywall.hidden = true;
  document.body.style.overflow = "";
}

$("viewPlansBtn").addEventListener("click", openPaywall);
$("paywallClose").addEventListener("click", closePaywall);
paywall.addEventListener("click", (e) => {
  if (e.target === paywall) closePaywall();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !paywall.hidden) closePaywall();
});

// Bascule mensuel / annuel
document
  .querySelectorAll(".cycle-btn")
  .forEach((b) =>
    b.addEventListener("click", () => {
      cycle = b.dataset.cycle;
      renderCycle();
    })
  );

// Boutons "Choisir Starter / Pro"
document.querySelectorAll(".plan-choose").forEach((btn) =>
  btn.addEventListener("click", () => subscribe(btn.dataset.plan, btn))
);

async function subscribe(plan, btn) {
  const err = $("paywallError");
  err.hidden = true;
  // Il faut un compte pour s'abonner → on redirige vers l'inscription.
  if (!currentUser) {
    closePaywall();
    openAuth("register");
    return;
  }
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "⏳ Redirection…";
  try {
    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan, cycle }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) throw new Error(data.error || "Paiement indisponible.");
    window.location.href = data.url; // redirection vers Stripe Checkout
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
    btn.disabled = false;
    btn.textContent = label;
  }
}

// ---------- Retour depuis Stripe ----------
(function handleBillingReturn() {
  const params = new URLSearchParams(location.search);
  const paiement = params.get("paiement");
  if (!paiement) return;
  history.replaceState({}, "", location.pathname); // nettoie l'URL
  if (paiement === "succes") {
    const sid = params.get("session_id");
    fetch(`/api/billing/confirm?session_id=${encodeURIComponent(sid || "")}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.usage) {
          usage = d.usage;
          renderUsage();
        }
        const nom = d.usage?.plan === "pro" ? "Pro" : "Starter";
        showToast(`🎉 Bienvenue dans ${nom} ! Votre abonnement est actif.`);
      })
      .catch(() => showToast("Paiement reçu. Actualisez si besoin."));
  } else if (paiement === "annule") {
    showToast("Paiement annulé — aucun montant débité.");
  }
})();

// Ouverture depuis les boutons de la navbar (login / register)
document
  .querySelectorAll("[data-auth-open]")
  .forEach((b) => b.addEventListener("click", () => openAuth(b.dataset.authOpen)));

// Onglets Connexion / Inscription
document
  .querySelectorAll(".auth-tab")
  .forEach((t) => t.addEventListener("click", () => setAuthMode(t.dataset.tab)));

// Fermeture (croix, clic sur le fond, touche Échap)
$("authClose").addEventListener("click", closeAuth);
authModal.addEventListener("click", (e) => {
  if (e.target === authModal) closeAuth();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !authModal.hidden) closeAuth();
});

// Soumission du formulaire
authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideAuthError();
  const email = authEmail.value.trim();
  const password = authPassword.value;
  if (!email || !password)
    return showAuthError("Renseignez votre e-mail et votre mot de passe.");
  if (authMode === "register" && password.length < 8)
    return showAuthError("Le mot de passe doit contenir au moins 8 caractères.");

  const label = authSubmit.textContent;
  authSubmit.disabled = true;
  authSubmit.textContent = "⏳ Un instant…";
  try {
    const res = await fetch(`/api/auth/${authMode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Une erreur est survenue.");
    setUser(data.user, data.usage);
    closeAuth();
    authForm.reset();
    $("generateur").scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => $("details").focus({ preventScroll: true }), 450);
  } catch (err) {
    showAuthError(err.message);
  } finally {
    authSubmit.disabled = false;
    authSubmit.textContent = label;
  }
});

// Déconnexion
$("logoutBtn").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  setUser(null, null);
});

// État de session au chargement de la page
fetch("/api/auth/me")
  .then((r) => r.json())
  .then((d) => setUser(d.user, d.usage))
  .catch(() => {});

// ---------- Preuve sociale (bas à gauche) ----------
(function socialProof() {
  const el = $("socialProof");
  const timeEl = $("spTime");
  let events = [];
  let idx = 0;
  let hideTimer;
  let stopped = false;

  const rel = (iso) => {
    const s = Math.max(1, Math.floor((Date.now() - new Date(iso)) / 1000));
    if (s < 60) return "à l'instant";
    const m = Math.floor(s / 60);
    if (m < 60) return `il y a ${m} min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `il y a ${h} h`;
    const d = Math.floor(h / 24);
    return d === 1 ? "hier" : `il y a ${d} jours`;
  };

  const hide = () => {
    el.classList.remove("show");
    setTimeout(() => (el.hidden = true), 350);
  };

  const showOne = () => {
    if (stopped || !events.length) return;
    const ev = events[idx % events.length];
    idx++;
    timeEl.textContent = rel(ev.at);
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add("show"));
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 6000);
  };

  const load = async () => {
    try {
      const d = await (await fetch("/api/social-proof")).json();
      events = d.events || [];
    } catch {
      /* silencieux */
    }
  };

  $("spClose").addEventListener("click", () => {
    stopped = true;
    hide();
  });

  // Recharge la liste puis affiche une notification, en boucle.
  const tick = () => load().then(showOne);
  setTimeout(tick, 3500); // premier affichage après 3,5 s
  setInterval(tick, 22000); // puis toutes les 22 s (capte les nouvelles ventes)
})();

let selectedType = "Offre d'emploi";

// --- Sélection du type de contenu ---
$("typeSelect").addEventListener("click", (e) => {
  const btn = e.target.closest(".type-btn");
  if (!btn) return;
  document.querySelectorAll(".type-btn").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  selectedType = btn.dataset.type;

  const isJob = selectedType === "Offre d'emploi";
  $("poste").placeholder = isJob
    ? "Poste / rôle (ex : Vendeur en boulangerie)"
    : "Sujet du post (ex : On recrute ! / Lancement produit)";
  $("details").placeholder = isJob
    ? "Décris le poste à pourvoir… (missions, avantages, lieu, contrat, ambiance…)"
    : "Décris le sujet du post… (message clé, offre, événement, ton souhaité…)";
});

// --- Génération ---
$("generateBtn").addEventListener("click", generate);

async function generate() {
  const btn = $("generateBtn");
  const resultWrap = $("resultWrap");
  const result = $("result");
  const copyBtn = $("copyBtn");
  const isJob = selectedType === "Offre d'emploi";

  const champPrincipal = $("poste").value.trim();
  const payload = {
    type: selectedType,
    entreprise: $("entreprise").value.trim(),
    poste: isJob ? champPrincipal : "",
    sujet: isJob ? "" : champPrincipal,
    ton: $("ton").value,
    details: $("details").value.trim(),
    motsCles: $("motsCles").value.trim(),
  };

  if (!payload.details && !payload.poste && !payload.sujet) {
    shake(btn);
    alert("Ajoutez au moins un poste, un sujet ou quelques détails.");
    return;
  }

  // État de chargement
  btn.disabled = true;
  btn.textContent = "⏳ Génération en cours…";
  copyBtn.hidden = true;
  resultWrap.hidden = false;
  result.innerHTML = '<div id="live"></div><span class="cursor"></span>';
  resultWrap.scrollIntoView({ behavior: "smooth", block: "start" });

  let raw = "";

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    // Génération réservée aux comptes connectés
    if (res.status === 401) {
      resultWrap.hidden = true;
      openAuth("login");
      showAuthError("Connectez-vous pour générer votre contenu.");
      return;
    }

    // Quota gratuit épuisé → proposer l'abonnement
    if (res.status === 402) {
      resultWrap.hidden = true;
      openPaywall();
      return;
    }

    if (!res.ok) {
      const { error } = await res.json().catch(() => ({}));
      throw new Error(error || "Erreur du serveur.");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split("\n\n");
      buffer = parts.pop();

      for (const part of parts) {
        const evt = part.match(/^event: (.+)$/m);
        const data = part.match(/^data: (.+)$/m);
        if (!evt || !data) continue;
        const payloadEvt = JSON.parse(data[1]);

        if (evt[1] === "delta") {
          raw += payloadEvt.text;
          const live = $("live");
          if (live) live.innerHTML = markdownToHtml(raw);
        } else if (evt[1] === "error") {
          throw new Error(payloadEvt.message);
        }
      }
    }

    result.innerHTML = markdownToHtml(raw);
    copyBtn.hidden = false;
    copyBtn.onclick = () => copyText(raw, copyBtn);
    refreshUsage(); // met à jour le compteur de générations restantes
  } catch (err) {
    result.innerHTML = `<div class="error-box">⚠️ ${escapeHtml(
      err.message || "Une erreur est survenue."
    )}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "✨ Générer mon contenu";
  }
}

// --- Copie ---
async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = "✅ Copié !";
    setTimeout(() => (btn.textContent = "📋 Copier"), 2000);
  } catch {
    btn.textContent = "❌ Échec";
  }
}

// --- Petit effet "secousse" en cas d'oubli ---
function shake(el) {
  el.animate(
    [
      { transform: "translateX(0)" },
      { transform: "translateX(-6px)" },
      { transform: "translateX(6px)" },
      { transform: "translateX(0)" },
    ],
    { duration: 250 }
  );
}

// --- Apparition des fonctionnalités au scroll ---
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add("shown");
        io.unobserve(e.target);
      }
    }
  },
  { threshold: 0.2 }
);
document.querySelectorAll(".reveal-on-scroll").forEach((el, i) => {
  el.style.transitionDelay = `${i * 0.1}s`;
  io.observe(el);
});

// --- Mini-rendu Markdown ---
function markdownToHtml(md) {
  const lines = escapeHtml(md).split("\n");
  let html = "";
  let inList = false;
  const closeList = () => {
    if (inList) {
      html += "</ul>";
      inList = false;
    }
  };
  for (let line of lines) {
    line = line.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    if (/^###\s+/.test(line)) {
      closeList();
      html += `<h3>${line.replace(/^###\s+/, "")}</h3>`;
    } else if (/^##?\s+/.test(line)) {
      closeList();
      html += `<h2>${line.replace(/^##?\s+/, "")}</h2>`;
    } else if (/^\s*[-*]\s+/.test(line)) {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${line.replace(/^\s*[-*]\s+/, "")}</li>`;
    } else if (/^(-{3,}|_{3,})\s*$/.test(line)) {
      closeList();
      html += "<hr />";
    } else if (line.trim() === "") {
      closeList();
    } else {
      closeList();
      html += `<p>${line}</p>`;
    }
  }
  closeList();
  return html;
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}
