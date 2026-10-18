/**
 * Envoi des demandes de devis depuis le Gmail de Pictura peinture.
 *
 * À installer une seule fois, connecté avec le compte Gmail de l'entreprise :
 * script.google.com → Nouveau projet → coller ce fichier → Déployer →
 * Nouveau déploiement → type « Application Web », exécuter en tant que « Moi »,
 * accès « Tout le monde » → copier l'URL obtenue dans index.html (ENVOI_URL).
 *
 * Deux e-mails partent à chaque demande :
 *  - à l'entreprise, avec les coordonnées du client (« Répondre » écrit au client) ;
 *  - au client, signé Pictura peinture, avec le récapitulatif de son estimation.
 */
const ENTREPRISE = {
  nom: 'Pictura peinture',
  email: 'pictura.halter@gmail.com',
  telephone: '06 45 56 38 97',
  site: 'https://yoannhalter93-ui.github.io/pictura-peinture/',
};
const ORANGE = '#fd6941';
const SAUGE = '#56614a';

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    const nom = texte(d.nom, 80);
    const email = texte(d.email, 120);
    const tel = texte(d.telephone, 30);
    if (!nom || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || tel.replace(/\D/g, '').length < 10) {
      return json({ ok: false, erreur: 'coordonnées incomplètes' });
    }
    const lignes = (Array.isArray(d.lignes) ? d.lignes : []).slice(0, 10).map(l => ({
      titre: texte(l.titre, 80), info: texte(l.info, 120), total: Math.max(0, Math.round(Number(l.total) || 0)),
    }));
    const min = Math.max(0, Math.round(Number(d.min) || 0));
    const max = Math.max(0, Math.round(Number(d.max) || 0));
    if (!lignes.length || !max) return json({ ok: false, erreur: 'estimation vide' });
    const ville = texte(d.ville, 80);
    const precisions = texte(d.precisions, 1500);
    const fourchette = `entre ${euros(min)} et ${euros(max)} TTC`;

    // 1. À l'entreprise
    MailApp.sendEmail({
      to: ENTREPRISE.email,
      replyTo: email,
      name: 'Site ' + ENTREPRISE.nom,
      subject: `Demande de devis : ${nom} (${euros(min)} – ${euros(max)})`,
      htmlBody: cadre(`
        <h2 style="margin:0 0 12px;color:${SAUGE}">Nouvelle demande de devis</h2>
        <table style="border-collapse:collapse;font-size:15px">
          ${ligneInfo('Nom', nom)}${ligneInfo('Téléphone', `<a href="tel:${esc(tel.replace(/\s/g, ''))}">${esc(tel)}</a>`, true)}
          ${ligneInfo('E-mail', `<a href="mailto:${esc(email)}">${esc(email)}</a>`, true)}${ville ? ligneInfo('Ville', ville) : ''}
        </table>
        ${detail(lignes, fourchette)}
        ${precisions ? `<p style="margin:16px 0 0"><b>Précisions :</b><br>${esc(precisions).replace(/\n/g, '<br>')}</p>` : ''}
        <p style="margin:16px 0 0;color:#676d60;font-size:13px">Répondez à cet e-mail pour écrire directement au client.</p>`),
    });

    // 2. Au client
    MailApp.sendEmail({
      to: email,
      replyTo: ENTREPRISE.email,
      name: ENTREPRISE.nom,
      subject: 'Votre estimation de travaux – ' + ENTREPRISE.nom,
      htmlBody: cadre(`
        <p style="margin:0 0 12px">Bonjour ${esc(nom)},</p>
        <p style="margin:0 0 12px">Merci pour votre demande. Voici le récapitulatif de votre estimation :</p>
        ${detail(lignes, fourchette)}
        <p style="margin:16px 0 0;color:#676d60;font-size:13px">Cette estimation est indicative et non contractuelle : le prix définitif est fixé après visite.</p>
        <p style="margin:16px 0 0">Nous vous rappelons rapidement. Pour plus de détails, répondez simplement à cet e-mail ou appelez-nous au <b>${ENTREPRISE.telephone}</b>.</p>
        <p style="margin:16px 0 0">À bientôt,<br><b>${ENTREPRISE.nom}</b><br>Artisan peintre</p>`),
    });

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, erreur: String(err) });
  }
}

/** Lancez cette fonction une fois depuis l'éditeur pour autoriser l'envoi d'e-mails. */
function autoriser() {
  MailApp.getRemainingDailyQuota();
}

function detail(lignes, fourchette) {
  return `
    <table style="border-collapse:collapse;width:100%;margin-top:16px;font-size:15px">
      ${lignes.map(l => `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #dedcd3">${esc(l.titre)}<br><span style="color:#676d60;font-size:13px">${esc(l.info)}</span></td>
        <td style="padding:8px 0;border-bottom:1px solid #dedcd3;text-align:right;white-space:nowrap">≈ ${euros(l.total)}</td></tr>`).join('')}
    </table>
    <p style="margin:14px 0 0;font-size:18px"><b>Estimation : <span style="color:${ORANGE}">${fourchette}</span></b></p>`;
}

function cadre(contenu) {
  return `<div style="background:#f5f4f0;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#2b2e27">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">
      <div style="background:${ORANGE};color:#fff;padding:16px 24px;font-size:22px;font-weight:bold;letter-spacing:.04em">PICTURA <span style="font-weight:normal;font-size:14px;letter-spacing:.2em">PEINTURE</span></div>
      <div style="padding:24px">${contenu}</div>
      <div style="background:${SAUGE};color:#fff;padding:12px 24px;font-size:13px">${ENTREPRISE.nom} · ${ENTREPRISE.telephone} · <a style="color:#fff" href="${ENTREPRISE.site}">${ENTREPRISE.site.replace('https://', '')}</a></div>
    </div></div>`;
}

function ligneInfo(label, valeur, html) {
  return `<tr><td style="padding:3px 16px 3px 0;color:#676d60">${label}</td><td style="padding:3px 0"><b>${html ? valeur : esc(valeur)}</b></td></tr>`;
}
function texte(v, max) { return String(v == null ? '' : v).trim().slice(0, max); }
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function euros(n) { return Utilities.formatString('%s €', String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')); }
function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
