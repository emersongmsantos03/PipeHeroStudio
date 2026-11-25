import {
  EMPTY_DRAFT, SAMPLE_APPOINTMENTS, slotLabel, type Appointment, type DetailingDraft,
} from '../../shared/detailing-quote';
import { campaignFromBrowser } from './campaign-browser';
import { typingDots } from './typing-dots';

type Turn = { role: 'user' | 'assistant'; content: string };
type Intent = 'none' | 'quote' | 'book' | 'reschedule' | 'cancel_booking' | 'cancel_quote';
type Lead = {
  id: string; type: 'quote' | 'booking'; car: string; service: string; name: string; phone: string; email: string;
  notes: string; photo: string; status: string; appointment: string;
};
type CustomerReply = { reply: string; intent: Intent; details: DetailingDraft; commit: boolean; slotLabel: string };
type OwnerReply = { reply: string; action: { type: 'none' | 'reschedule' | 'cancel' | 'confirm'; appointmentId: string; slot: string } };

const demo = document.querySelector<HTMLElement>('[data-detailing-demo]');
if (demo) setup(demo);

function setup(root: HTMLElement) {
  const chat = root.querySelector<HTMLFormElement>('[data-chat]')!;
  const dialogue = root.querySelector<HTMLElement>('[data-dialogue]')!;
  const message = chat.querySelector<HTMLInputElement>('#demo-message')!;
  const dialog = root.querySelector<HTMLDialogElement>('[data-ava-dialog]')!;
  const shopInbox = root.querySelector<HTMLDetailsElement>('[data-shop-inbox]')!;
  const requestResult = dialog.querySelector<HTMLElement>('[data-request-result]')!;
  const requestStatus = dialog.querySelector<HTMLElement>('[data-request-status]')!;
  const launcher = root.querySelector<HTMLElement>('.ava-launch');

  // Demo "CRM" and calendar, kept in this tab only.
  const appointments: Appointment[] = SAMPLE_APPOINTMENTS.map((item) => ({ ...item }));
  const leads: Lead[] = [];
  let details: DetailingDraft = { ...EMPTY_DRAFT };
  let intent: Intent = 'none';
  let activeLead: Lead | null = null;
  let bookingId = '';
  let counter = 0;

  let opener: HTMLElement | null = null;
  function openAva(trigger?: HTMLElement) {
    if (dialog.open) return;
    opener = trigger ?? null;
    if (matchMedia('(max-width: 620px)').matches) dialog.showModal();
    else dialog.show();
    launcher?.setAttribute('aria-expanded', 'true');
    dialog.querySelector<HTMLButtonElement>('[data-ava-close]')?.focus({ preventScroll: true });
  }
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && dialog.open) dialog.close();
  });
  dialog.addEventListener('close', () => {
    launcher?.setAttribute('aria-expanded', 'false');
    opener?.focus({ preventScroll: true });
  });
  root.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const trigger = target?.closest<HTMLElement>('[data-ava-open]');
    const question = target?.closest<HTMLElement>('[data-question]')?.dataset.question;
    if (trigger) {
      event.preventDefault();
      openAva(trigger);
      if (trigger.hasAttribute('data-start-quote') && intent === 'none' && !activeLead) {
        intent = 'quote';
        greet('Of course. What car do you drive, and what would you like done?');
      }
    }
    if (question) {
      message.value = question;
      message.focus();
    }
    if (target?.closest('[data-shop-link]')) {
      shopInbox.open = true;
      if (dialog.open) dialog.close();
    }
  });
  dialog.querySelector('[data-ava-close]')!.addEventListener('click', () => dialog.close());
  if (location.hash === '#ava') openAva();
  if (location.hash === '#shop-view') shopInbox.open = true;
  window.addEventListener('hashchange', () => {
    if (location.hash === '#ava') openAva();
    if (location.hash === '#shop-view') shopInbox.open = true;
  });

  const photo = chat.querySelector<HTMLInputElement>('[data-photo]')!;
  const thumbnail = chat.querySelector<HTMLImageElement>('[data-thumbnail]')!;
  const attachment = chat.querySelector<HTMLElement>('[data-attachment]')!;
  const photoStatus = chat.querySelector<HTMLElement>('[data-photo-status]')!;
  const remove = chat.querySelector<HTMLButtonElement>('[data-remove]')!;
  const prompts = dialog.querySelector<HTMLElement>('[data-ava-prompts]')!;
  const samplePhoto = dialog.querySelector<HTMLButtonElement>('[data-example]')!;
  const submit = chat.querySelector<HTMLButtonElement>('button[type=submit]')!;
  const owner = root.querySelector<HTMLFormElement>('[data-owner]')!;
  const ownerMessage = owner.querySelector<HTMLInputElement>('#owner-message')!;
  for (const prompt of owner.querySelectorAll<HTMLButtonElement>('[data-owner-question]')) {
    prompt.addEventListener('click', () => {
      ownerMessage.value = prompt.dataset.ownerQuestion || '';
      owner.requestSubmit();
    });
  }
  const ownerAnswer = owner.querySelector<HTMLElement>('[data-owner-answer]')!;
  const inbox = root.querySelector<HTMLUListElement>('[data-inbox]')!;
  const calendar = root.querySelector<HTMLUListElement>('[data-calendar]')!;
  const messages: Turn[] = [];
  const ownerTurns: Turn[] = [];
  const sessionId = crypto.randomUUID();
  const use = (name: string) => document.dispatchEvent(new CustomEvent('offer-demo-started', { detail: name }));
  let image = '';
  let imageSelection = 0;
  let readingPhoto = false;
  let lastPhoto = '';
  const photoUrl = (value: string) => value === 'sample' ? '/images/detailing-studio.webp' : value;

  function greet(text: string) {
    show('Ava', text);
    messages.push({ role: 'assistant', content: text });
  }

  dialog.querySelector('[data-new-request]')!.addEventListener('click', () => {
    if (submit.disabled) return;
    activeLead = null;
    details = { ...EMPTY_DRAFT, name: details.name, phone: details.phone, email: details.email, emailSkipped: details.emailSkipped };
    intent = 'quote';
    lastPhoto = '';
    messages.length = 0;
    requestResult.hidden = true;
    imageSelection++;
    readingPhoto = false;
    updateImage('', '');
    message.value = '';
    greet('Sure! What car is this one for, and what would you like done?');
    message.focus();
  });
  let started = false;

  function updateImage(value: string, status: string) {
    image = value;
    if (value) thumbnail.src = photoUrl(value);
    else thumbnail.removeAttribute('src');
    thumbnail.hidden = remove.hidden = !value;
    attachment.hidden = !value && !status;
    photoStatus.textContent = status;
  }

  photo.addEventListener('change', async () => {
    const file = photo.files?.[0];
    if (!file) return;
    const selection = ++imageSelection;
    readingPhoto = true;
    updateImage('', 'Preparing photo…');
    try {
      if (file.size > 12_000_000 || !/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error();
      const bitmap = await createImageBitmap(file);
      try {
        const scale = Math.min(1, 768 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext('2d')!;
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        if (selection === imageSelection) updateImage(canvas.toDataURL('image/jpeg', .76), 'Vehicle photo ready to send.');
      } finally {
        bitmap.close();
      }
    } catch {
      if (selection === imageSelection) updateImage('', 'Choose a JPEG, PNG or WebP photo under 12 MB.');
    } finally {
      if (selection === imageSelection) readingPhoto = false;
      photo.value = '';
    }
  });
  samplePhoto.addEventListener('click', () => {
    imageSelection++;
    readingPhoto = false;
    updateImage('sample', 'Sample vehicle photo ready to send.');
    if (!message.value) message.value = 'What can you see in this photo, and which service might fit?';
  });
  remove.addEventListener('click', () => {
    imageSelection++;
    readingPhoto = false;
    updateImage('', '');
  });

  function show(role: 'Ava' | 'You', content: string, attached = '') {
    const row = document.createElement('div');
    row.className = 'ava-turn ' + (role === 'Ava' ? 'ava-turn-assistant' : 'ava-turn-customer');
    const label = document.createElement('span');
    label.className = 'ava-speaker';
    label.textContent = role;
    const bubble = document.createElement('p');
    bubble.className = 'ava-bubble';
    bubble.textContent = content;
    row.append(label, bubble);
    if (attached) {
      const preview = document.createElement('img');
      preview.src = photoUrl(attached);
      preview.alt = 'Photo you shared with Ava';
      preview.width = 118;
      preview.height = 76;
      bubble.append(preview);
    }
    dialogue.append(row);
    dialogue.scrollTop = dialogue.scrollHeight;
    return row;
  }

  async function ask<T>(payload: object) {
    const response = await fetch('/api/detailing-demo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...campaignFromBrowser(), sessionId, appointments, ...payload }),
    });
    const result = await response.json() as T & { reply?: string; error?: string };
    if (!response.ok || !result.reply) throw new Error(result.error || 'Ava is unavailable. Please try again.');
    return result;
  }

  function notify(text: string) {
    requestStatus.textContent = text;
    requestResult.hidden = false;
  }

  function leadFromDetails(type: Lead['type'], status: string, appointment = ''): Lead {
    return {
      id: 'l' + (++counter), type, car: details.car, service: details.service, name: details.name, phone: details.phone,
      email: details.email, notes: details.notes, photo: lastPhoto, status, appointment,
    };
  }

  function applyCustomer(result: CustomerReply) {
    details = { ...result.details };
    if (result.intent === 'cancel_quote') {
      if (activeLead && activeLead.type === 'quote') {
        leads.splice(leads.indexOf(activeLead), 1);
        activeLead = null;
        notify('Quote request removed from the CRM.');
      }
      intent = 'none';
      render();
      return;
    }
    if (result.intent !== 'none') intent = result.intent;

    // A photo shared after the request is attached to the same CRM record.
    if (activeLead && lastPhoto && activeLead.photo !== lastPhoto) {
      activeLead.photo = lastPhoto;
      notify('Photo added to your request.');
    }
    if (!result.commit) { render(); return; }

    if (intent === 'quote') {
      if (activeLead) Object.assign(activeLead, leadFromDetails(activeLead.type, activeLead.status), { id: activeLead.id });
      else {
        activeLead = leadFromDetails('quote', 'New · Needs a quote');
        leads.unshift(activeLead);
        use('detailing_quote');
      }
      notify('Request sent to Northline’s CRM.');
    } else if (intent === 'book') {
      const appointment: Appointment = {
        id: 'v' + (++counter), slot: details.slot, service: details.service, customer: details.name,
        car: details.car, phone: details.phone, status: 'Booked by Ava',
      };
      appointments.push(appointment);
      bookingId = appointment.id;
      const status = 'Booked · ' + slotLabel(details.slot);
      if (activeLead) Object.assign(activeLead, { type: 'booking', status, appointment: appointment.id, phone: details.phone, name: details.name, email: details.email });
      else {
        activeLead = leadFromDetails('booking', status, appointment.id);
        leads.unshift(activeLead);
      }
      use('detailing_booking');
      notify('Booked for ' + slotLabel(details.slot) + '. Added to the shop calendar.');
    } else if (intent === 'reschedule') {
      const appointment = appointments.find((item) => item.id === bookingId);
      if (appointment) {
        appointment.slot = details.slot;
        appointment.status = 'Rescheduled';
        if (activeLead) activeLead.status = 'Rescheduled · ' + slotLabel(details.slot);
        notify('Moved to ' + slotLabel(details.slot) + '.');
      }
    } else if (intent === 'cancel_booking') {
      const index = appointments.findIndex((item) => item.id === bookingId);
      if (index >= 0) appointments.splice(index, 1);
      bookingId = '';
      if (activeLead) activeLead.status = 'Cancelled by customer';
      notify('Appointment cancelled.');
    }
    details.slot = '';
    intent = 'none';
    render();
  }

  chat.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submit.disabled || readingPhoto) return;
    const typed = message.value.trim();
    if (!typed && !image) {
      message.focus();
      return;
    }
    const content = typed || 'What can you see in this photo, and what should I ask a detailer to check?';
    submit.disabled = true;
    if (!started) { use('detailing'); started = true; }
    const attached = image;
    updateImage('', '');
    const turn = { role: 'user', content } as const;
    message.value = '';
    show('You', typed || 'I shared a vehicle photo.', attached);
    prompts.hidden = true;
    const status = show('Ava', '');
    status.classList.add('ava-thinking');
    status.querySelector('.ava-bubble')!.append(typingDots('Ava is typing', 'ava-dots'));
    dialog.classList.add('is-typing');
    dialogue.scrollTop = dialogue.scrollHeight;
    try {
      const result = await ask<CustomerReply>({
        mode: 'customer', messages: [...messages, turn], image: attached,
        state: { details, intent, booking: bookingId ? { id: bookingId } : null, quoteSent: Boolean(activeLead) },
      });
      messages.push(turn, { role: 'assistant', content: result.reply });
      if (messages.length > 12) messages.splice(0, 2);
      status.remove();
      show('Ava', result.reply);
      if (attached) lastPhoto = attached;
      applyCustomer(result);
    } catch (error) {
      status.remove();
      show('Ava', (error as Error).message || 'Please try again.');
      if (!message.value) message.value = content;
      if (attached && !image) updateImage(attached, 'Photo ready to retry.');
    } finally {
      dialog.classList.remove('is-typing');
      submit.disabled = false;
    }
  });

  function render() {
    inbox.replaceChildren(...leads.map((entry) => {
      const li = document.createElement('li');
      const title = document.createElement('b');
      title.textContent = entry.name || 'New contact';
      const tag = document.createElement('span');
      tag.className = 'crm-tag';
      tag.textContent = entry.type === 'booking' ? 'Booking' : 'Quote';
      li.append(title, ' ', tag, document.createElement('br'), [entry.car, entry.service].filter(Boolean).join(' · '));
      const contact = [entry.phone, entry.email].filter(Boolean).join(' · ');
      if (contact) li.append(document.createElement('br'), contact);
      const state = document.createElement('small');
      state.textContent = entry.status + (entry.photo ? ' · Photo attached' : '');
      li.append(document.createElement('br'), state);
      if (entry.photo) {
        const picture = document.createElement('img');
        picture.src = photoUrl(entry.photo);
        picture.alt = 'Vehicle photo supplied for this request';
        picture.width = 112;
        picture.height = 72;
        li.append(picture);
      }
      if (entry.notes) {
        const notes = document.createElement('p');
        notes.className = 'crm-notes';
        notes.textContent = entry.notes;
        li.append(notes);
      }
      return li;
    }));
    root.querySelector<HTMLElement>('[data-empty]')!.hidden = leads.length > 0;

    const sorted = [...appointments].sort((a, b) => a.slot.localeCompare(b.slot));
    calendar.replaceChildren(...sorted.map((item) => {
      const li = document.createElement('li');
      if (item.id.startsWith('v')) li.className = 'is-new';
      const when = document.createElement('strong');
      when.textContent = slotLabel(item.slot);
      const status = document.createElement('small');
      status.textContent = item.status;
      li.append(when, document.createElement('br'), `${item.service} · ${item.customer}`, document.createElement('br'), item.car, document.createElement('br'), status);
      return li;
    }));
  }
  render();

  owner.addEventListener('submit', async (event) => {
    event.preventDefault();
    const ownerSend = owner.querySelector<HTMLButtonElement>('button[type=submit]')!;
    const question = ownerMessage.value.trim();
    if (!question || ownerSend.disabled) return;
    ownerSend.disabled = true;
    ownerAnswer.replaceChildren(typingDots('Ava is checking your shop', 'ava-dots'));
    const turn = { role: 'user', content: question } as const;
    try {
      const { reply, action } = await ask<OwnerReply>({
        mode: 'owner', messages: [...ownerTurns, turn],
        leads: leads.map(({ photo, ...lead }) => ({ ...lead, photo: Boolean(photo) })),
      });
      ownerTurns.push(turn, { role: 'assistant', content: reply });
      if (ownerTurns.length > 6) ownerTurns.splice(0, 2);
      ownerAnswer.textContent = reply;
      ownerMessage.value = '';
      const appointment = appointments.find((item) => item.id === action?.appointmentId);
      if (appointment && action.type !== 'none') {
        const lead = leads.find((entry) => entry.appointment === appointment.id);
        if (action.type === 'reschedule' && action.slot) {
          appointment.slot = action.slot;
          appointment.status = 'Rescheduled';
          if (lead) lead.status = 'Rescheduled by the shop · ' + slotLabel(action.slot);
        } else if (action.type === 'cancel') {
          appointments.splice(appointments.indexOf(appointment), 1);
          if (appointment.id === bookingId) bookingId = '';
          if (lead) lead.status = 'Cancelled by the shop';
        } else if (action.type === 'confirm') {
          appointment.status = 'Confirmed';
          if (lead) lead.status = 'Confirmed · ' + slotLabel(appointment.slot);
        }
        render();
      }
    } catch (error) {
      ownerAnswer.textContent = (error as Error).message || 'Please try again.';
    } finally {
      ownerSend.disabled = false;
    }
  });
}
