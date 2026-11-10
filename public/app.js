/* Mess Hub — vanilla JavaScript client. All records are stored by the server. */
(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  let todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  let today = new Date(`${todayKey}T12:00:00`);
  const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  let monthKey = todayKey.slice(0, 7);
  const parseDate = key => new Date(`${key}T12:00:00`);
  const formatDate = (date, options = {}) => date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...options });
  const money = amount => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
  const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const iconPaths = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    utensils: '<path d="M5 3v7m3-7v7m3-7v7M5 7h6m-6 3q3 4 6 0M8 13v8M19 3v18m0-18q-6 4-3 10h3"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2m-8 3h2"/>',
    check: '<path d="m6 12 4 4 8-8"/><circle cx="12" cy="12" r="9"/>',
    wallet: '<path d="M20 8V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h15V8H5a2 2 0 0 1 0-4"/><path d="M20 12h-5v5h5m-3-2.5h.1"/>',
    message: '<path d="M21 11a8 8 0 0 1-8 8H7l-4 3V11a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z"/><path d="M7 9h10M7 13h7"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-9 12q3 3 6 0"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    leaf: '<path d="M20 3c-9-1-16 2-16 9a7 7 0 0 0 7 7c7 0 9-8 9-16ZM3 22l12-13m-5 5v-4m0 4h5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    megaphone: '<path d="m3 9 17-5v16L3 15V9Zm4 7 2 5h4l-2-4M3 9v6"/>',
  };
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${iconPaths[name] || iconPaths.info}</svg>`;
  const meals = ['Breakfast', 'Lunch', 'Dinner'];
  const times = ['7:30 – 9:00 AM', '12:30 – 2:00 PM', '7:30 – 9:00 PM'];
  const mealEmoji = ['🥞', '🍛', '🥘'];
  const routes = [ ['dashboard', 'Overview', 'grid'], ['menu', 'Weekly menu', 'utensils'], ['bookings', 'My bookings', 'calendar'], ['attendance', 'Attendance', 'check'], ['payments', 'Bills & payments', 'wallet'], ['feedback', 'Feedback', 'message'], ['admin', 'Administration', 'grid'] ];
  let state = null, adminData = null, adminTab = 'summary', adminDate = todayKey;
  let route = 'dashboard', selectedDay = todayKey, bookingTab = 'upcoming', calendarOffset = 0, selectedRating = 0, toastTimer;
  let busy = false, pendingPaymentMonth = monthKey, authMode = 'login';
  const bookingId = (date, meal) => `${date}_${meal}`;
  const bookingStatus = (date, meal) => state.bookings[bookingId(date, meal)] || 'unbooked';
  const isAttended = (date, meal) => Boolean(state.attendance[bookingId(date, meal)]);
  const currentBill = () => state.bills.find(bill => bill.month === monthKey);
  const isPaid = () => currentBill()?.status === 'simulated_paid';
  const pendingBills = () => state.bills.filter(bill => bill.status === 'pending');
  async function api(path, method = 'GET', data) {
    let response;
    try {
      response = await fetch(path, { method, credentials: 'same-origin', headers: { 'X-Mess-Request': '1', ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
    } catch { throw new Error('Could not confirm the server response. Refresh your workspace before retrying.'); }
    const result = await response.json().catch(() => ({ error: 'Unexpected server response. Please reload and sign in again.' }));
    if (!response.ok) { const error = new Error(result.error || 'The request failed.'); error.status = response.status; throw error; }
    return result;
  }
  async function refresh() {
    state = await api('/api/state');
    todayKey = state.today; monthKey = todayKey.slice(0, 7); today = parseDate(todayKey);
    if (route === 'admin' && state.profile.role === 'admin') adminData = await api(`/api/admin/overview?date=${adminDate}`);
    render();
  }
  async function mutate(path, method, data, message, close = false) {
    await api(path, method, data);
    if (close) closeModal();
    await refresh();
    toast(message);
  }
  function toast(message) {
    const el = $('#toast');
    clearTimeout(toastTimer); el.textContent = message; el.classList.add('visible');
    toastTimer = setTimeout(() => el.classList.remove('visible'), 4200);
  }
  function openModal(title, html) {
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = html;
    if (!$('#modal').open) $('#modal').showModal();
  }
  function closeModal() { $('#modal').close(); }
  function updateProfile() {
    const initials = state.profile.name.trim().split(/\s+/).map(word => word[0]).slice(0, 2).join('').toUpperCase();
    $('#sidebar-name').textContent = state.profile.name;
    $('#sidebar-roll').textContent = `${state.profile.roll || 'Add roll number'} · ${state.profile.hostel}`;
    $('#sidebar-initials').textContent = initials;
    $('#header-profile').textContent = initials;
  }
  function heading(title, subtitle, eyebrow = 'YOUR CAMPUS, CONNECTED') {
    return `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${subtitle}</p></div><div class="date-box">${icon('calendar')}${formatDate(today, { weekday: 'short', year: 'numeric' })}</div></div>`;
  }
  function stat(label, value, note, symbol, suffix = '') {
    return `<article class="stat"><div class="stat-top"><span class="stat-label">${label}</span><span class="stat-icon">${icon(symbol)}</span></div><div class="stat-value">${value}${suffix ? `<small>${suffix}</small>` : ''}</div><div class="stat-note">${note}</div></article>`;
  }
  function mealCard(date, index, detailed = false) {
    const status = bookingStatus(date, index), attended = isAttended(date, index), past = date < todayKey;
    const entry = state.menus.find(item => item.weekday === (parseDate(date).getDay() + 6) % 7 && item.meal === index);
    const menu = entry?.description || 'Menu to be announced';
    const statusText = attended ? 'Checked in' : status === 'booked' ? 'Meal booked' : status === 'skipped' ? 'Meal skipped' : 'Not booked';
    const actionText = attended ? 'Served ✓' : past ? 'Closed' : status === 'booked' ? 'Skip meal' : 'Book meal';
    return `<article class="meal-card"><div class="meal-art"><div class="food-illustration" aria-hidden="true"><span>${mealEmoji[index]}</span></div><span class="meal-tag">${escapeHTML(entry?.diet || 'Menu pending')}</span></div><div class="meal-content"><div class="meal-top"><h3>${meals[index]}</h3><span class="meal-time">${times[index]}</span></div><p>${escapeHTML(menu)}</p><div class="meal-footer"><span class="status ${status !== 'booked' && !attended ? 'skipped' : ''}">${statusText}</span><button class="meal-action" data-action="booking" data-date="${date}" data-meal="${index}" ${past || attended ? 'disabled' : ''} aria-label="${actionText} for ${meals[index]} on ${date}">${actionText}</button></div></div></article>`;
  }
  const plate = `<div class="plate-art" aria-hidden="true"><svg viewBox="0 0 260 220"><ellipse cx="140" cy="124" rx="84" ry="83" fill="#a7b28b" opacity=".15"/><circle cx="137" cy="111" r="82" fill="#fbfbef"/><circle cx="137" cy="111" r="72" fill="#e1e6d4"/><circle cx="137" cy="111" r="66" fill="#f5f5e6"/><path d="M135 53c-36 3-54 30-47 64 6 15 30 27 50 14 17-9 20-47-3-78" fill="#e1d2a4"/><path d="M103 77q17-15 27 3m-34 9q20-9 35 0m-34 10q19-6 35 0m-28 11q16-7 28 0" stroke="#ede4c5" stroke-width="4" stroke-linecap="round"/><circle cx="163" cy="86" r="24" fill="#a7793d"/><circle cx="163" cy="86" r="20" fill="#bc8d4d"/><circle cx="157" cy="80" r="5" fill="#e2bb74"/><circle cx="171" cy="84" r="5" fill="#dfb166"/><circle cx="160" cy="93" r="5" fill="#ddac60"/><path d="m160 76 5-3m7 18 4 1m-24-3-3-3" stroke="#64814b" stroke-width="3"/><path d="M150 124c10-22 31-12 36-4 9 22-15 38-35 28-5-8-7-16-1-24" fill="#65804a"/><path d="m150 130 28-4m-24 13 23-4" stroke="#8ca161" stroke-width="4"/><ellipse cx="121" cy="150" rx="22" ry="18" fill="#d6a75f"/><path d="m108 145 19 8m-16-13 19 9m-17-15 17 10" stroke="#b38948" stroke-width="1.5"/><circle cx="140" cy="139" r="10" fill="#c66f4c"/><circle cx="140" cy="139" r="7" fill="#e4a17a"/><circle cx="148" cy="155" r="10" fill="#8ca86b"/><circle cx="148" cy="155" r="7" fill="#c6d5a5"/><path d="M35 47v43q0 8 7 8v82M29 48v33m13-33v33m7-33v33M229 46v134m0-134q-15 10-12 49h12" stroke="#8f9b7e" stroke-width="3" fill="none"/><path d="m202 29 7-6m-2 16 9-1M63 183l-6 6m16-1-2 9" stroke="#9aaa83" stroke-width="2"/></svg></div>`;
  function notices() {
    return `<section class="panel notices" aria-label="Announcements"><h2>${icon('megaphone')} Notice board</h2>${state.notices.length ? state.notices.slice(0, 3).map(notice => `<article class="notice"><div class="notice-date">${formatDate(new Date(notice.created_at))} · MESS COMMITTEE</div><h3>${escapeHTML(notice.title)}</h3><p>${escapeHTML(notice.body)}</p></article>`).join('') : '<p class="subtle">No announcements at the moment.</p>'}</section>`;
  }
  function activityRows(all = false) {
    const list = all ? state.activity : state.activity.slice(0, 3);
    if (!list.length) return `<div class="activity-row"><span class="activity-icon">${icon('leaf')}</span><div class="activity-text"><strong>A fresh start to your mess experience</strong><small>Your bookings, check-ins and feedback will appear here.</small></div></div>`;
    return list.map(item => `<div class="activity-row"><span class="activity-icon">${icon(item.type)}</span><div class="activity-text"><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.detail)}</small></div><span>${formatDate(new Date(item.timestamp))}</span></div>`).join('');
  }
  function renderDashboard() {
    const booked = meals.filter((_, i) => bookingStatus(todayKey, i) === 'booked').length;
    const attended = Object.keys(state.attendance).filter(key => key.startsWith(monthKey)).length;
    const skipped = Object.entries(state.bookings).filter(([key, status]) => key.startsWith(monthKey) && status === 'skipped').length;
    return `${heading(`Hello, ${escapeHTML(state.profile.name.trim().split(/\s+/)[0])} <span class="wave" aria-hidden="true">👋</span>`, 'A little less hassle. A little more good food. Here’s your mess at a glance.')}
      <section class="hero"><div class="hero-content"><div class="eyebrow"><span class="live-dot"></span> GOOD FOOD. GOOD CAMPUS LIFE.</div><h2>Your meals, made simple.</h2><p>Know what’s cooking, plan your meals,<br>and make every plate count.</p><div class="hero-actions"><a href="#menu" class="button primary">Explore this week’s menu ${icon('arrow')}</a><a href="#bookings" class="button ghost">Manage bookings ↗</a></div></div><span class="hero-scribble">a little taste of home ↘</span>${plate}</section>
      <section class="stats-grid" aria-label="Mess statistics">${stat('Today’s meals', String(booked).padStart(2, '0'), '<span class="good">Ready when you are</span> · of 3 meals', 'utensils')}${stat('Meals attended', String(attended).padStart(2, '0'), 'Your check-ins this month', 'check')}${stat('Mess bill', isPaid() ? 'Settled' : money(currentBill()?.amount || 0), isPaid() ? '<span class="good">Demo payment complete</span>' : 'This month · Server-issued bill', 'wallet')}${stat('Meals skipped', String(skipped).padStart(2, '0'), '<span class="good">A little planning, less waste</span>', 'leaf')}</section>
      <div class="content-grid"><section><div class="section-heading"><div><h2>On the menu today</h2><p>Freshly prepared. Served with a little care.</p></div><a class="text-link" href="#menu">View weekly menu ${icon('arrow')}</a></div><div class="meal-grid">${meals.map((_, i) => mealCard(todayKey, i)).join('')}</div></section>${notices()}</div>
      <div class="lower-grid"><section class="panel activity-panel"><div class="section-heading"><h2>Your recent activity</h2><button class="text-link" data-action="activity">View all ${icon('arrow')}</button></div>${activityRows()}</section><section class="eco-card">${icon('leaf')}<div class="eyebrow">SMALL ACTIONS. BIG IMPACT.</div><h3>Take what you need.<br>Love what you eat.</h3><p>Skipping a meal? Let us know. Together, we can make our mess a little more mindful.</p><a href="#bookings">Plan your next meal ↗</a></section></div>`;
  }
  function renderMenu() {
    const start = new Date(today); start.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const week = Array.from({ length: 7 }, (_, i) => { const date = new Date(start); date.setDate(start.getDate() + i); return date; });
    return `${heading('A week of good food.', 'Your shared campus menu. Choose a day, see what’s cooking, and plan ahead.', 'THE WEEKLY MENU')}<div class="view-toolbar"><div class="subtle">${formatDate(week[0])} – ${formatDate(week[6], { year: 'numeric' })}</div><span class="badge">Vegetarian options daily</span></div><div class="week-days" role="group" aria-label="Select menu day">${week.map(date => `<button class="day-button ${dateKey(date) === selectedDay ? 'active' : ''}" aria-pressed="${dateKey(date) === selectedDay}" data-action="day" data-date="${dateKey(date)}">${formatDate(date, { weekday: 'short' }).split(',')[0].split(' ')[0]}<strong>${date.getDate()}</strong></button>`).join('')}</div><div class="section-heading"><div><h2>${selectedDay === todayKey ? 'Today' : formatDate(parseDate(selectedDay), { weekday: 'long' })}’s menu</h2><p>Your bookings are securely saved to your account.</p></div></div><div class="meal-grid menu-detail">${meals.map((_, i) => mealCard(selectedDay, i, true)).join('')}</div><div class="info-strip">${icon('info')}<span>Menus are managed by your administrator. Ask the mess committee about dietary or allergy information. Skipping meals does not change the monthly flat-rate bill.</span></div>`;
  }
  function renderBookings() {
    const rows = Object.entries(state.bookings).filter(([key]) => bookingTab === 'upcoming' ? key.slice(0, 10) >= todayKey : key.slice(0, 10) < todayKey).sort(([a], [b]) => bookingTab === 'upcoming' ? a.localeCompare(b) : b.localeCompare(a));
    return `${heading('A little planning goes a long way.', 'Book what you’ll eat. Skip what you won’t. Keep your meals in one place.', 'MY BOOKINGS')}<div class="view-toolbar"><div class="segmented"><button data-action="booking-tab" data-tab="upcoming" class="${bookingTab === 'upcoming' ? 'active' : ''}" aria-pressed="${bookingTab === 'upcoming'}">Today & upcoming</button><button data-action="booking-tab" data-tab="past" class="${bookingTab === 'past' ? 'active' : ''}" aria-pressed="${bookingTab === 'past'}">Past meals</button></div><a class="button primary" href="#menu">${icon('calendar')} Book a meal</a></div><div class="table-wrap"><table><thead><tr><th>DATE & MEAL</th><th>MEAL TIMING</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>${rows.length ? rows.map(([key, status]) => {
      const date = key.slice(0, 10), meal = Number(key.slice(11)), attended = isAttended(date, meal);
      return `<tr><td>${formatDate(parseDate(date), { weekday: 'short' })}<small>${meals[meal]}</small></td><td>${times[meal]}</td><td><span class="badge ${status === 'skipped' ? 'neutral' : ''}">${attended ? 'Checked in' : status === 'booked' ? 'Booked' : 'Skipped'}</span></td><td>${date >= todayKey && !attended ? `<button class="text-link" data-action="booking" data-date="${date}" data-meal="${meal}">${status === 'booked' ? 'Skip meal' : 'Book again'}</button>` : '—'}</td></tr>`;
    }).join('') : '<tr><td colspan="4" class="empty-state">No meals here yet. Choose a meal from the weekly menu to get started.</td></tr>'}</tbody></table></div><div class="info-strip">${icon('leaf')}<span>Book meals from the weekly menu. You can manage today’s and future meals. Served meals and past bookings stay in your history.</span></div>`;
  }
  function renderAttendance() {
    const month = new Date(today.getFullYear(), today.getMonth() + calendarOffset, 1);
    const year = month.getFullYear(), monthIndex = month.getMonth(), monthPrefix = dateKey(month).slice(0, 7);
    const count = Object.keys(state.attendance).filter(key => key.startsWith(monthPrefix)).length;
    const offset = (month.getDay() + 6) % 7, days = new Date(year, monthIndex + 1, 0).getDate();
    return `${heading('Every meal, accounted for.', 'Check in for today’s booked meals and keep track of your attendance.', 'MEAL ATTENDANCE')}<div class="section-heading"><div><h2>Today’s check-in</h2><p>Record the meals you have eaten. One check-in is allowed per booked meal.</p></div></div><div class="meal-grid">${meals.map((meal, i) => `<article class="panel"><div class="section-heading"><h2>${meal}</h2>${icon('utensils')}</div><p class="subtle">${times[i]}</p><button class="button ${isAttended(todayKey, i) ? 'secondary' : 'primary'}" data-action="check-in" data-meal="${i}" ${isAttended(todayKey, i) || bookingStatus(todayKey, i) !== 'booked' ? 'disabled' : ''}>${isAttended(todayKey, i) ? 'Checked in ✓' : bookingStatus(todayKey, i) !== 'booked' ? 'Book meal to check in' : 'Check in'}</button></article>`).join('')}</div><section class="panel section-space"><div class="section-heading"><div><h2>${formatDate(month, { month: 'long', year: 'numeric', day: undefined })}</h2><p>${count} meal${count === 1 ? '' : 's'} attended this month</p></div><div class="inline-actions"><button class="button secondary" data-action="month" data-direction="-1" aria-label="Previous month">←</button><button class="button secondary" data-action="month" data-direction="1" aria-label="Next month" ${calendarOffset >= 0 ? 'disabled' : ''}>→</button></div></div><div class="calendar">${['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map(day => `<div class="calendar-heading">${day}</div>`).join('')}${'<div aria-hidden="true"></div>'.repeat(offset)}${Array.from({ length: days }, (_, i) => {
      const date = dateKey(new Date(year, monthIndex, i + 1));
      const attended = meals.filter((_, meal) => isAttended(date, meal)).length;
      return `<div class="calendar-day ${date === todayKey ? 'today' : date > todayKey ? 'future' : ''}" aria-label="${date}: ${attended} meals attended"><b>${i + 1}</b><div class="dots" aria-hidden="true">${meals.map((_, meal) => `<i class="${isAttended(date, meal) ? 'present' : ''}"></i>`).join('')}</div>${date === todayKey ? '<span>TODAY</span>' : ''}</div>`;
    }).join('')}</div><div class="calendar-legend"><span><i></i>Attended</span><span><i></i>No check-in</span><span>Dots: breakfast · lunch · dinner</span></div></section>`;
  }
  function renderPayments() {
    const outstanding = pendingBills().reduce((sum, bill) => sum + bill.amount, 0);
    return `${heading('Good food. Clear accounts.', 'Server-issued monthly bills and your payment history in one place.', 'BILLS & PAYMENTS')}
      <section class="balance-panel"><div><p>Total outstanding · ${pendingBills().length} pending bill(s)</p><strong>${money(outstanding)}</strong><small>Payments in this project are simulations. No money is collected.</small></div><span class="badge">${pendingBills().length ? 'Action needed' : 'All settled'}</span></section>
      <div class="section-heading"><div><h2>Your bills</h2><p>Bill amounts are set by your mess administrator.</p></div><button class="text-link" data-action="export">${icon('download')} Export payments</button></div>
      <div class="table-wrap"><table><thead><tr><th>BILLING MONTH</th><th>AMOUNT</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>${state.bills.length ? state.bills.map(bill => `<tr><td>${formatDate(parseDate(`${bill.month}-01`), { month: 'long', year: 'numeric', day: undefined })}${bill.timestamp ? `<small>Recorded ${formatDate(new Date(bill.timestamp))}</small>` : ''}</td><td>${money(bill.amount)}</td><td><span class="badge ${bill.status === 'pending' ? 'warning' : ''}">${bill.status === 'pending' ? 'Pending' : 'Simulation recorded'}</span></td><td>${bill.status === 'pending' ? `<button class="text-link" data-action="pay" data-month="${bill.month}">Simulate payment ${icon('arrow')}</button>` : `<button class="text-link" data-action="receipt" data-id="${escapeHTML(bill.receipt)}">Download receipt ${icon('download')}</button>`}</td></tr>`).join('') : '<tr><td colspan="4" class="empty-state">No bills have been issued.</td></tr>'}</tbody></table></div>
      <div class="info-strip">${icon('info')}<span>Payment simulation records are stored in the database and visible to the administrator. They do not confirm a bank transaction. A real payment gateway is required to collect money.</span></div>`;
  }
  function renderFeedback() {
    selectedRating = 0;
    return `${heading('A better mess starts with you.', 'Tell us what’s working, what could be better, or what you’d love on your plate.', 'YOUR VOICE MATTERS')}<div class="form-grid"><section class="panel"><div class="section-heading"><div><h2>Share your experience</h2><p>Small suggestions can make a big difference.</p></div></div><form id="feedback-form"><div class="form-field"><span class="field-label" id="rating-label">How was your experience?</span><div class="rating" role="group" aria-labelledby="rating-label">${[1, 2, 3, 4, 5].map(rating => `<button type="button" data-action="rate" data-rating="${rating}" aria-label="${rating} star${rating === 1 ? '' : 's'}" aria-pressed="false">★</button>`).join('')}</div><small id="rating-description">Choose a rating from 1 to 5.</small></div><div class="form-field"><label for="category">What’s it about?</label><select id="category" name="category"><option>Food quality</option><option>Menu suggestion</option><option>Hygiene & cleanliness</option><option>Service & timing</option><option>Other</option></select></div><div class="form-field"><label for="feedback-message">Your feedback</label><textarea id="feedback-message" name="message" placeholder="A dish you loved? Something we can improve? Tell us here…" required minlength="10" maxlength="1500"></textarea><small>At least 10 characters. Your feedback will be visible to the administrator.</small></div><button type="submit" class="button primary">Share feedback ${icon('arrow')}</button></form></section><section class="panel"><div class="section-heading"><div><h2>Your feedback</h2><p>${state.feedback.length} suggestion${state.feedback.length === 1 ? '' : 's'} shared in this workspace</p></div></div><div class="feedback-list">${state.feedback.length ? state.feedback.map(item => `<article class="feedback-item"><div class="feedback-stars" aria-label="${item.rating} out of 5 stars">${'★'.repeat(item.rating)}${'☆'.repeat(5 - item.rating)}</div><h3>${escapeHTML(item.category)}</h3><p>${escapeHTML(item.message)}</p><small>${formatDate(new Date(item.timestamp), { year: 'numeric' })} · ${escapeHTML(item.status === 'reviewed' ? 'Reviewed by admin' : 'Awaiting review')}</small></article>`).join('') : `<div class="empty-state">${icon('message')}Your voice belongs here.<br><br>Share your first suggestion using the form.</div>`}</div></section></div>`;
  }
  let adminMenuDay = (today.getDay() + 6) % 7;
  const weekNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const emptyRow = (columns, message) => `<tr><td class="empty-state" colspan="${columns}">${message}</td></tr>`;
  function renderAdmin() {
    if (state.profile.role !== 'admin') return '<div class="empty-state">Administrator access is required.</div>';
    if (!adminData) return '<div class="empty-state">Loading administration…</div>';
    const data = adminData;
    let content = '';
    if (adminTab === 'summary') {
      content = `<div class="view-toolbar"><div class="subtle">Kitchen planning and attendance for the selected date.</div><div class="form-field compact"><label for="admin-date">Report date</label><input type="date" id="admin-date" value="${adminDate}"></div></div>
        <div class="stats-grid">${stat('Registered accounts', data.counts.students, 'Students and administrators', 'grid')}${stat('Meals booked', data.bookings.filter(item => item.status === 'booked').length, `For ${formatDate(parseDate(adminDate))}`, 'utensils')}${stat('Meals served', data.attendance.length, 'Recorded check-ins', 'check')}${stat('Open feedback', data.counts.openFeedback, 'Awaiting review', 'message')}</div>
        <div class="meal-grid">${meals.map((meal, index) => `<article class="panel"><h3>${meal}</h3><p class="subtle">${data.bookings.filter(item => item.meal === index && item.status === 'booked').length} booked · ${data.attendance.filter(item => item.meal === index).length} checked in</p></article>`).join('')}</div>
        <div class="section-heading section-space"><h2>Booking register · ${formatDate(parseDate(adminDate))}</h2></div><div class="table-wrap"><table><thead><tr><th>STUDENT</th><th>MEAL</th><th>BOOKING</th><th>ATTENDANCE</th></tr></thead><tbody>${data.bookings.map(item => `<tr><td>${escapeHTML(item.name)}<small>${escapeHTML(item.roll || 'Profile incomplete')}</small></td><td>${meals[item.meal]}</td><td><span class="badge ${item.status === 'skipped' ? 'neutral' : ''}">${item.status}</span></td><td>${data.attendance.some(record => record.student_id === item.student_id && record.meal === item.meal) ? 'Checked in ✓' : 'No check-in'}</td></tr>`).join('') || emptyRow(4, 'No bookings for this date.')}</tbody></table></div>`;
    }
    if (adminTab === 'menu') {
      content = `<div class="view-toolbar"><div class="subtle">Menu changes are shared with every student.</div><div class="form-field compact"><label for="admin-menu-day">Weekday</label><select id="admin-menu-day">${weekNames.map((day, index) => `<option value="${index}" ${index === adminMenuDay ? 'selected' : ''}>${day}</option>`).join('')}</select></div></div><div class="meal-grid">${meals.map((meal, index) => {
        const entry = state.menus.find(item => item.weekday === adminMenuDay && item.meal === index);
        return `<form class="panel admin-menu-form" data-meal="${index}"><h3>${meal}</h3><div class="form-field"><label for="menu-description-${index}">Dishes</label><textarea id="menu-description-${index}" name="description" required minlength="5" maxlength="250">${escapeHTML(entry?.description || '')}</textarea></div><div class="form-field"><label for="menu-diet-${index}">Diet label</label><input id="menu-diet-${index}" name="diet" required minlength="2" maxlength="25" value="${escapeHTML(entry?.diet || 'Vegetarian')}"></div><button class="button primary" type="submit">Save ${meal.toLowerCase()}</button></form>`;
      }).join('')}</div>`;
    }
    if (adminTab === 'students') {
      content = `<div class="info-strip">${icon('info')}<span>Students create an account through student registration. Only administrators can change roles or deactivate accounts.</span></div><div class="table-wrap section-space"><table><thead><tr><th>STUDENT</th><th>ROLL NUMBER</th><th>HOSTEL</th><th>ROLE / STATUS</th><th>ACTION</th></tr></thead><tbody>${data.students.map(student => `<tr><td>${escapeHTML(student.name)}<small>${escapeHTML(student.email)}</small></td><td>${escapeHTML(student.roll || 'Not set')}</td><td>${escapeHTML(student.hostel)}</td><td><span class="badge ${student.active ? '' : 'neutral'}">${escapeHTML(student.role)} · ${student.active ? 'active' : 'inactive'}</span></td><td>${student.email === state.profile.email ? 'Your account' : `<button class="text-link" data-action="edit-student" data-id="${escapeHTML(student.id)}">Manage access</button>`}</td></tr>`).join('') || emptyRow(5, 'No student accounts yet.')}</tbody></table></div><p class="subtle">Showing up to 500 accounts, newest first.</p>`;
    }
    if (adminTab === 'feedback') {
      content = `<div class="admin-feedback-grid">${data.feedback.map(item => `<article class="panel"><div class="section-heading"><div><h2>${escapeHTML(item.category)}</h2><p>${escapeHTML(item.name)} · ${escapeHTML(item.roll || 'No roll number')}</p></div><span class="badge ${item.status === 'open' ? 'warning' : ''}">${item.status}</span></div><div class="feedback-stars" aria-label="${item.rating} out of 5 stars">${'★'.repeat(item.rating)}${'☆'.repeat(5 - item.rating)}</div><p class="feedback-message">${escapeHTML(item.message)}</p><div class="section-heading"><span class="subtle">${formatDate(new Date(item.created_at))}</span><button class="text-link" data-action="review-feedback" data-id="${escapeHTML(item.id)}" data-status="${item.status === 'open' ? 'reviewed' : 'open'}">${item.status === 'open' ? 'Mark reviewed ✓' : 'Reopen'}</button></div></article>`).join('') || '<div class="empty-state">No feedback has been submitted.</div>'}</div><p class="subtle">Showing the latest 100 entries.</p>`;
    }
    if (adminTab === 'bills') {
      content = `<section class="panel"><div class="section-heading"><div><h2>Issue monthly bills</h2><p>Issue or correct pending bills for active accounts. Settled simulations retain their receipt and original amount.</p></div></div><form id="admin-bill-form" class="admin-bill-form"><div class="form-field"><label for="bill-month">Billing month</label><input type="month" name="month" id="bill-month" max="${monthKey}" value="${monthKey}" required></div><div class="form-field"><label for="bill-amount">Monthly charge (₹)</label><input type="number" name="amount" id="bill-amount" min="0" max="100000" step="1" value="${currentBill()?.amount || 3200}" required></div><button type="submit" class="button primary">Issue / update bills</button></form></section><div class="table-wrap section-space"><table><thead><tr><th>STUDENT</th><th>MONTH</th><th>AMOUNT</th><th>STATUS</th></tr></thead><tbody>${data.bills.map(bill => `<tr><td>${escapeHTML(bill.name)}<small>${escapeHTML(bill.roll || 'No roll number')}</small></td><td>${bill.month}</td><td>${money(bill.amount)}</td><td><span class="badge ${bill.status === 'pending' ? 'warning' : ''}">${bill.status === 'pending' ? 'Pending' : 'Simulation recorded'}</span></td></tr>`).join('') || emptyRow(4, 'No bills have been issued.')}</tbody></table></div><p class="subtle">Showing up to 500 bills. Simulation records do not confirm a bank transaction.</p>`;
    }
    if (adminTab === 'notices') {
      content = `<div class="form-grid"><section class="panel"><h2 class="form-title">Post an announcement</h2><form id="notice-form"><div class="form-field"><label for="notice-title">Title</label><input name="title" id="notice-title" required minlength="3" maxlength="100"></div><div class="form-field"><label for="notice-message">Announcement</label><textarea name="body" id="notice-message" required minlength="10" maxlength="1000"></textarea></div><button class="button primary" type="submit">Publish announcement</button></form></section><section class="panel"><h2 class="form-title">Current announcements</h2>${state.notices.map(notice => `<article class="feedback-item"><h3>${escapeHTML(notice.title)}</h3><p>${escapeHTML(notice.body)}</p><div class="section-heading"><span class="subtle">${formatDate(new Date(notice.created_at))}</span><button class="text-link" data-action="delete-notice" data-id="${escapeHTML(notice.id)}">Remove</button></div></article>`).join('') || '<p class="subtle">No announcements.</p>'}</section></div>`;
    }
    return `${heading('Keep the campus well fed.', 'Manage menus, students, bookings, bills and feedback from one workspace.', 'MESS ADMINISTRATION')}<div class="admin-tabs" role="group" aria-label="Administration sections">${[['summary', 'Overview'], ['menu', 'Menu editor'], ['students', 'Students'], ['feedback', 'Feedback'], ['bills', 'Billing'], ['notices', 'Notices']].map(([key, name]) => `<button class="button ${adminTab === key ? 'primary' : 'secondary'}" data-action="admin-tab" data-tab="${key}" aria-pressed="${adminTab === key}">${name}</button>`).join('')}</div>${content}`;
  }
  function render() {
    if (!state) return;
    if (route === 'admin' && state.profile.role !== 'admin') route = 'dashboard';
    $('#main').innerHTML = ({ dashboard: renderDashboard, menu: renderMenu, bookings: renderBookings, attendance: renderAttendance, payments: renderPayments, feedback: renderFeedback, admin: renderAdmin }[route] || renderDashboard)();
    $('#breadcrumb').textContent = routes.find(item => item[0] === route)?.[1] || 'Overview';
    $('#navigation').innerHTML = routes.filter(item => item[0] !== 'admin' || state.profile.role === 'admin').map(([path, label, symbol]) => `<a class="nav-link ${route === path ? 'active' : ''}" href="#${path}" ${route === path ? 'aria-current="page"' : ''}>${icon(symbol)}<span>${label}</span>${path === 'payments' && pendingBills().length ? `<span class="nav-count">${pendingBills().length}</span>` : ''}</a>`).join('');
    document.title = `${routes.find(item => item[0] === route)?.[1]} · IIIT Mess Hub`;
    $('.workspace-label').textContent = state.profile.role === 'admin' ? 'ADMIN & STUDENT WORKSPACE' : 'STUDENT WORKSPACE';
    updateProfile();
  }
  async function navigate() {
    const next = location.hash.slice(1);
    route = routes.some(item => item[0] === next) ? next : 'dashboard';
    closeNavigation();
    if (!state) return;
    render(); window.scrollTo(0, 0);
    if (route === 'admin' && state.profile.role === 'admin') {
      try { adminData = await api(`/api/admin/overview?date=${adminDate}`); if (route === 'admin') render(); }
      catch (error) { toast(error.message); }
    }
  }
  function closeNavigation() { $('#sidebar').classList.remove('open'); $('#sidebar-backdrop').classList.remove('visible'); $('#menu-toggle').setAttribute('aria-expanded', 'false'); }
  function editProfile() {
    if (!state) return;
    openModal('Make yourself at home.', `<p class="modal-copy">Your profile is linked to your signed-in account. Add your roll number to book meals.</p><form id="profile-form"><div class="form-field"><label for="student-name">Full name</label><input id="student-name" name="name" value="${escapeHTML(state.profile.name)}" required minlength="2" maxlength="60"></div><div class="form-field"><label for="student-roll">Roll number</label><input id="student-roll" name="roll" value="${escapeHTML(state.profile.roll)}" required minlength="3" maxlength="20" pattern="[A-Za-z0-9-]+"></div><div class="form-field"><label for="student-hostel">Hostel</label><select name="hostel" id="student-hostel">${['Hostel A', 'Hostel B', 'Hostel C', 'Hostel D', 'Day scholar'].map(hostel => `<option ${state.profile.hostel === hostel ? 'selected' : ''}>${hostel}</option>`).join('')}</select></div><div class="modal-actions"><button type="button" class="button secondary" data-action="close">Cancel</button><button type="submit" class="button primary">Save profile</button></div></form>`);
  }
  function download(content, filename, type = 'text/plain') {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function pay(month) {
    const bill = state.bills.find(item => item.month === month);
    if (!bill || bill.status !== 'pending') return;
    pendingPaymentMonth = month;
    openModal('Record a payment simulation.', `<p class="modal-copy">This action records a simulation in the database. No money will be charged.</p><div class="summary-line"><span>Billing month</span><span>${month}</span></div><div class="summary-line total"><span>Simulation amount</span><span>${money(bill.amount)}</span></div><div class="modal-actions"><button class="button secondary" data-action="close">Cancel</button><button class="button primary" data-action="confirm-payment">Confirm simulation</button></div>`);
  }
  function editStudent(id) {
    const student = adminData?.students.find(item => item.id === id);
    if (!student) return;
    openModal('Manage student access', `<p class="modal-copy">${escapeHTML(student.name)} · ${escapeHTML(student.email)}</p><form id="student-access-form" data-id="${escapeHTML(id)}"><div class="form-field"><label for="account-role">Role</label><select id="account-role" name="role"><option value="student" ${student.role === 'student' ? 'selected' : ''}>Student</option><option value="admin" ${student.role === 'admin' ? 'selected' : ''}>Administrator</option></select></div><div class="form-field"><label for="account-active">Account status</label><select id="account-active" name="active"><option value="1" ${student.active ? 'selected' : ''}>Active</option><option value="0" ${!student.active ? 'selected' : ''}>Inactive</option></select></div><div class="modal-actions"><button type="button" class="button secondary" data-action="close">Cancel</button><button type="submit" class="button primary">Save access</button></div></form>`);
  }
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled) return;
    const { action, date, meal } = button.dataset;
    if (action === 'retry') return boot();
    if (action === 'auth-tab') return showAuth(button.dataset.mode);
    if (action === 'close') return closeModal();
    if (!state || busy) return;
    try {
      busy = true; button.disabled = true;
      if (action === 'logout') { await api('/api/auth/logout', 'POST', {}); closeModal(); showAuth(); toast('You are signed out.'); }
      if (action === 'refresh') { await refresh(); toast('Your workspace is up to date.'); }
      if (action === 'booking') {
        if (!state.profile.roll) return editProfile();
        const index = Number(meal), next = bookingStatus(date, index) === 'booked' ? 'skipped' : 'booked';
        await mutate('/api/bookings', 'POST', { date, meal: index, status: next }, `${meals[index]} ${next} for ${formatDate(parseDate(date))}.`);
      }
      if (action === 'day') { selectedDay = date; render(); }
      if (action === 'booking-tab') { bookingTab = button.dataset.tab; render(); }
      if (action === 'activity') openModal('Your recent activity', activityRows(true));
      if (action === 'check-in') await mutate('/api/attendance', 'POST', { date: todayKey, meal: Number(meal) }, `${meals[Number(meal)]} checked in. Enjoy your meal!`);
      if (action === 'month') { calendarOffset = Math.min(0, calendarOffset + Number(button.dataset.direction)); render(); }
      if (action === 'pay') { if (!state.profile.roll) return editProfile(); pay(button.dataset.month); }
      if (action === 'confirm-payment') await mutate('/api/payments/simulate', 'POST', { month: pendingPaymentMonth }, 'Simulation saved. Your receipt is ready.', true);
      if (action === 'export') {
        if (!state.payments.length) return toast('No recorded payment simulations to export yet.');
        const csv = ['Receipt,Month,Amount INR,Recorded date,Status', ...state.payments.map(payment => [payment.id, payment.month, payment.amount, payment.timestamp, 'Simulated payment'].join(','))].join('\r\n');
        download(csv, 'mess-hub-payments.csv', 'text/csv;charset=utf-8'); toast('Payment history exported.');
      }
      if (action === 'receipt') {
        const payment = state.payments.find(item => item.id === button.dataset.id);
        if (!payment) return;
        download(['IIIT BHUBANESWAR · MESS HUB', 'SIMULATED PAYMENT — NO MONEY COLLECTED', '', `Receipt: ${payment.id}`, `Student: ${state.profile.name}`, `Roll number: ${state.profile.roll}`, `Billing month: ${payment.month}`, `Amount: INR ${payment.amount}`, `Recorded: ${new Date(payment.timestamp).toLocaleString('en-IN')}`, '', 'This database record confirms a simulation, not a bank transaction.'].join('\n'), `${payment.id}.txt`);
        toast('Simulation receipt downloaded.');
      }
      if (action === 'rate') {
        selectedRating = Number(button.dataset.rating);
        document.querySelectorAll('[data-action="rate"]').forEach(star => { star.classList.toggle('selected', Number(star.dataset.rating) <= selectedRating); star.setAttribute('aria-pressed', String(Number(star.dataset.rating) === selectedRating)); });
        $('#rating-description').textContent = ['Needs improvement', 'Could be better', 'It was okay', 'Pretty good!', 'Loved it!'][selectedRating - 1];
      }
      if (action === 'admin-tab') { adminTab = button.dataset.tab; render(); }
      if (action === 'edit-student') editStudent(button.dataset.id);
      if (action === 'review-feedback') await mutate('/api/admin/feedback', 'PATCH', { id: button.dataset.id, status: button.dataset.status }, 'Feedback status updated.');
      if (action === 'delete-notice') openModal('Remove this announcement?', `<p class="modal-copy">The announcement will be removed from the shared notice board.</p><div class="modal-actions"><button class="button secondary" data-action="close">Cancel</button><button class="button danger" data-action="confirm-delete-notice" data-id="${escapeHTML(button.dataset.id)}">Remove announcement</button></div>`);
      if (action === 'confirm-delete-notice') await mutate('/api/admin/notices', 'DELETE', { id: button.dataset.id }, 'Announcement removed.', true);
    } catch (error) {
      toast(error.message);
      if (error.status === 401) showError(error);
    } finally { busy = false; if (button.isConnected) button.disabled = false; }
  });
  document.addEventListener('submit', async event => {
    const form = event.target;
    if (form.id === 'auth-form') {
      event.preventDefault(); if (busy) return;
      const submit = form.querySelector('[type=submit]');
      try {
        busy = true; submit.disabled = true;
        const values = Object.fromEntries(new FormData(form));
        await api(authMode === 'register' ? '/api/auth/register' : '/api/auth/login', 'POST', values);
        await boot();
      } catch (error) { toast(error.message); }
      finally { busy = false; if (submit.isConnected) submit.disabled = false; }
      return;
    }
    if (!['feedback-form', 'profile-form', 'student-access-form', 'notice-form', 'admin-bill-form'].includes(form.id) && !form.classList.contains('admin-menu-form')) return;
    event.preventDefault(); if (busy) return;
    const submit = form.querySelector('[type="submit"]'), values = Object.fromEntries(new FormData(form));
    try {
      busy = true; if (submit) submit.disabled = true;
      if (form.id === 'feedback-form') {
        if (!selectedRating) { toast('Choose a star rating before sharing your feedback.'); $('[data-action="rate"]').focus(); return; }
        await mutate('/api/feedback', 'POST', { ...values, rating: selectedRating }, 'Thanks! Your feedback is now visible to the administrator.');
      }
      if (form.id === 'profile-form') await mutate('/api/profile', 'PATCH', values, 'Your profile is updated.', true);
      if (form.classList.contains('admin-menu-form')) await mutate('/api/admin/menu', 'PATCH', { ...values, weekday: adminMenuDay, meal: Number(form.dataset.meal) }, 'Menu updated for everyone.');
      if (form.id === 'notice-form') await mutate('/api/admin/notices', 'POST', values, 'Announcement published.');
      if (form.id === 'admin-bill-form') await mutate('/api/admin/bills', 'POST', { month: values.month, amount: Number(values.amount) }, 'Monthly bills issued. Settled records were preserved.');
      if (form.id === 'student-access-form') await mutate('/api/admin/students', 'PATCH', { id: form.dataset.id, role: values.role, active: values.active === '1' }, 'Student access updated.', true);
    } catch (error) { toast(error.message); }
    finally { busy = false; if (submit?.isConnected) submit.disabled = false; }
  });
  document.addEventListener('change', async event => {
    if (event.target.id === 'admin-menu-day') { adminMenuDay = Number(event.target.value); render(); }
    if (event.target.id === 'admin-date') {
      adminDate = event.target.value || todayKey;
      try { adminData = await api(`/api/admin/overview?date=${adminDate}`); if (route === 'admin') render(); }
      catch (error) { toast(error.message); }
    }
  });
  function showAuth(mode = 'login') {
    authMode = mode; state = null; adminData = null; document.body.classList.add('signed-out');
    $('#main').innerHTML = `<section class="auth-card"><div class="eyebrow">IIIT BHUBANESWAR · MESS HUB</div><h1>${mode === 'register' ? 'A place at the table.' : 'Your campus. Your meals.'}</h1><p>${mode === 'register' ? 'Create your student account to manage your meals.' : 'Sign in to your student or administrator account.'}</p><div class="segmented auth-tabs"><button type="button" data-action="auth-tab" data-mode="login" class="${mode === 'login' ? 'active' : ''}">Sign in</button><button type="button" data-action="auth-tab" data-mode="register" class="${mode === 'register' ? 'active' : ''}">Student registration</button></div><form id="auth-form">${mode === 'register' ? '<div class="form-field"><label for="auth-name">Full name</label><input id="auth-name" name="name" autocomplete="name" required minlength="2" maxlength="60"></div>' : ''}<div class="form-field"><label for="auth-email">Email</label><input type="email" id="auth-email" name="email" autocomplete="username" required maxlength="254"></div><div class="form-field"><label for="auth-password">Password</label><input type="password" id="auth-password" name="password" autocomplete="${mode === 'register' ? 'new-password' : 'current-password'}" required minlength="12" maxlength="128"><small>Use at least 12 characters.</small></div><button type="submit" class="button primary">${mode === 'register' ? 'Create student account' : 'Sign in'} ${icon('arrow')}</button></form><p class="subtle">${mode === 'register' ? 'Administrator accounts are managed by the mess administrator.' : 'New here? Choose Student registration to get started.'}</p></section>`;
  }
  function showError(error) {
    if (error.status === 401) return showAuth();
    state = null; document.body.classList.add('signed-out');
    $('#main').innerHTML = `<section class="auth-card"><div class="eyebrow">IIIT BHUBANESWAR · MESS HUB</div><h1>Let’s reconnect.</h1><p>${escapeHTML(error.message)}</p><button class="button primary" data-action="retry">Try again</button></section>`;
  }
  async function boot() {
    $('#main').innerHTML = '<div class="empty-state">Connecting to your mess workspace…</div>';
    try {
      state = await api('/api/bootstrap', 'POST', {});
      document.body.classList.remove('signed-out');
      todayKey = state.today; monthKey = todayKey.slice(0, 7); today = parseDate(todayKey); selectedDay = todayKey; adminDate = todayKey;
      await navigate();
      if (!state.profile.roll) editProfile();
    } catch (error) { showError(error); }
  }
  $('#menu-toggle').innerHTML = icon('menu');
  $('#notification-button').innerHTML = icon('bell');
  $('#menu-toggle').addEventListener('click', () => { const open = $('#sidebar').classList.toggle('open'); $('#sidebar-backdrop').classList.toggle('visible', open); $('#menu-toggle').setAttribute('aria-expanded', String(open)); });
  $('#sidebar-backdrop').addEventListener('click', closeNavigation);
  $('#profile-button').addEventListener('click', editProfile);
  $('#header-profile').addEventListener('click', editProfile);
  $('#notification-button').addEventListener('click', () => { if (state) openModal('Around the mess', notices()); });
  $('#close-modal').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', event => { if (event.target === $('#modal')) { const rect = $('#modal').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeModal(); } });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeNavigation(); });
  window.addEventListener('hashchange', navigate);
  boot();
})();
