/* Pipe Hero Studio — comportamento da página.
 * O formulário envia os pedidos pelo Netlify Forms (só funciona com a página publicada no Netlify). */
(function () {
  "use strict";

  var cfg = window.SITE_CONFIG || {};
  var lang = (document.documentElement.lang || "en").slice(0, 2).toLowerCase();

  var T = {
    pt: {
      required: "Preencha este campo.",
      contactRequired: "Indique o e-mail ou o telefone.",
      badEmail: "Este e-mail não parece completo. Exemplo: nome@clinica.pt",
      badPhone: "Indique um número com pelo menos 9 dígitos.",
      fixErrors: "Há campos por corrigir no formulário.",
      sending: "A enviar…",
      successTitle: function (n) { return "Obrigado, " + n + "."; },
      successText: "Recebi o seu pedido e vou responder-lhe pessoalmente em breve.",
      sendFail: function (e) { return "Não foi possível enviar o pedido. Tente de novo dentro de momentos" + (e ? " ou escreva para " + e : "") + "."; },
      localOnly: "Está a ver a página no seu computador: o envio só funciona depois de a página estar publicada no Netlify.",
      copied: "E-mail copiado.",
      copyFail: "Não foi possível copiar. Selecione o texto e copie manualmente.",
      noEmail: "(e-mail por configurar)"
    },
    en: {
      required: "Please fill in this field.",
      contactRequired: "Please give your email or phone number.",
      badEmail: "This email doesn't look complete. For example: name@clinic.co.uk",
      badPhone: "Please give a number with at least 9 digits.",
      fixErrors: "Some fields in the form need correcting.",
      sending: "Sending…",
      successTitle: function (n) { return "Thank you, " + n + "."; },
      successText: "I've received your request and will reply to you personally soon.",
      sendFail: function (e) { return "Your request couldn't be sent. Please try again in a moment" + (e ? " or email " + e : "") + "."; },
      localOnly: "You're viewing the page on your own computer: sending only works once the page is published on Netlify.",
      copied: "Email copied.",
      copyFail: "Couldn't copy. Please select the text and copy it manually.",
      noEmail: "(email not set)"
    },
    es: {
      required: "Rellene este campo.",
      contactRequired: "Indique su correo o su teléfono.",
      badEmail: "Este correo no parece completo. Por ejemplo: nombre@clinica.es",
      badPhone: "Indique un número con al menos 9 dígitos.",
      fixErrors: "Hay campos del formulario por corregir.",
      sending: "Enviando…",
      successTitle: function (n) { return "Gracias, " + n + "."; },
      successText: "He recibido su solicitud y le responderé personalmente en breve.",
      sendFail: function (e) { return "No se ha podido enviar la solicitud. Inténtelo de nuevo en unos momentos" + (e ? " o escriba a " + e : "") + "."; },
      localOnly: "Está viendo la página en su ordenador: el envío solo funciona cuando la página está publicada en Netlify.",
      copied: "Correo copiado.",
      copyFail: "No se ha podido copiar. Seleccione el texto y cópielo a mano.",
      noEmail: "(correo sin configurar)"
    }
  };
  var t = T[lang] || T.en;

  /* Dados de config.js nos elementos marcados */
  var email = (cfg.EMAIL || "").trim();
  document.querySelectorAll("[data-config='email']").forEach(function (el) {
    el.textContent = email || t.noEmail;
  });
  document.querySelectorAll("[data-config='email-link']").forEach(function (el) {
    if (email) {
      el.textContent = email;
      el.setAttribute("href", "mailto:" + email);
    } else {
      el.textContent = t.noEmail;
      el.removeAttribute("href");
    }
  });
  var founder = (cfg.FOUNDER_NAME || "").trim();
  document.querySelectorAll("[data-config='founder']").forEach(function (el) {
    if (founder) el.textContent = founder;
  });
  var insta = (cfg.INSTAGRAM || "pipehero.studio").replace(/^@/, "").trim();
  document.querySelectorAll("[data-config='instagram']").forEach(function (el) {
    el.textContent = "@" + insta;
    el.setAttribute("href", "https://www.instagram.com/" + encodeURIComponent(insta) + "/");
  });
  var booking = (cfg.BOOKING_URL || "").trim();
  document.querySelectorAll("[data-config='booking']").forEach(function (el) {
    if (/^https?:\/\//i.test(booking)) {
      el.setAttribute("href", booking);
      el.hidden = false;
    }
  });
  var phoneNumber = String(cfg.WHATSAPP || "").replace(/\D/g, "");
  document.querySelectorAll("[data-config='whatsapp']").forEach(function (el) {
    if (phoneNumber) {
      el.setAttribute("href", "https://wa.me/" + phoneNumber);
      el.hidden = false;
    }
  });
  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = String(new Date().getFullYear());
  });

  /* Guardar a língua escolhida para a página inicial */
  document.querySelectorAll("[data-lang-link]").forEach(function (a) {
    a.addEventListener("click", function () {
      try { localStorage.setItem("phs-lang", a.getAttribute("data-lang-link")); } catch (e) {}
    });
  });

  /* Copiar e-mail */
  var copyBtn = document.querySelector("[data-copy-email]");
  var copyStatus = document.querySelector("[data-copy-status]");
  if (copyBtn) {
    if (!email) copyBtn.hidden = true;
    copyBtn.addEventListener("click", function () {
      var done = function () { if (copyStatus) copyStatus.textContent = t.copied; };
      var fail = function () { if (copyStatus) copyStatus.textContent = t.copyFail; };
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(email).then(done, function () { legacyCopy() ? done() : fail(); });
      } else {
        legacyCopy() ? done() : fail();
      }
    });
  }
  function legacyCopy() {
    try {
      var ta = document.createElement("textarea");
      ta.value = email;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  /* Formulário: valida e envia para o Netlify Forms */
  var form = document.getElementById("contact-form");
  if (!form) return;
  var status = form.querySelector("[data-form-status]");
  var submitBtn = form.querySelector("[data-submit]");
  var success = document.querySelector("[data-form-success]");
  var f = form.elements;
  var contactError = document.getElementById("contact-error");

  function setError(input, msg) {
    var box = document.getElementById(input.id + "-error");
    if (msg) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
    if (box) box.textContent = msg || "";
  }

  function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); }
  function validPhone(v) { return v.replace(/\D/g, "").length >= 9; }

  function validate() {
    var firstInvalid = null;
    function mark(el, msg) {
      setError(el, msg);
      if (msg && !firstInvalid) firstInvalid = el;
    }
    mark(f.name, f.name.value.trim() ? "" : t.required);
    mark(f.clinic, f.clinic.value.trim() ? "" : t.required);

    var em = f.email.value.trim();
    var ph = f.phone.value.trim();
    contactError.textContent = "";
    if (!em && !ph) {
      setError(f.email, "");
      setError(f.phone, "");
      f.email.setAttribute("aria-invalid", "true");
      f.phone.setAttribute("aria-invalid", "true");
      contactError.textContent = t.contactRequired;
      if (!firstInvalid) firstInvalid = f.email;
    } else {
      mark(f.email, em && !validEmail(em) ? t.badEmail : "");
      mark(f.phone, ph && !validPhone(ph) ? t.badPhone : "");
    }
    return firstInvalid;
  }

  ["name", "clinic", "email", "phone"].forEach(function (id) {
    f[id].addEventListener("input", function () {
      if (f[id].getAttribute("aria-invalid") === "true") validate();
    });
  });

  var isLocal = location.protocol === "file:" || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    status.textContent = "";

    var firstInvalid = validate();
    if (firstInvalid) {
      status.textContent = t.fixErrors;
      firstInvalid.focus();
      return;
    }
    if (isLocal) {
      status.textContent = t.localOnly;
      return;
    }

    var data = new URLSearchParams();
    Array.prototype.forEach.call(f, function (el) {
      if (!el.name || el.type === "submit") return;
      data.append(el.name, el.value.trim());
    });

    var label = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = t.sending;

    fetch("/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: data.toString()
    }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      success.querySelector("[data-success-title]").textContent = t.successTitle(f.name.value.trim());
      success.querySelector("[data-success-text]").textContent = t.successText;
      form.hidden = true;
      success.hidden = false;
      success.focus();
    }).catch(function () {
      status.textContent = t.sendFail(email);
      submitBtn.disabled = false;
      submitBtn.textContent = label;
    });
  });
})();
