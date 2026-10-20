/* Progressive enhancement: content and download links work before animation starts. */
(() => {
  'use strict';
  document.documentElement.classList.remove('no-js');
  const header = document.querySelector('#site-header');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const mobile = window.matchMedia('(max-width: 768px)');
  const cards = [...document.querySelectorAll('[data-shadow]')];
  const lights = [...document.querySelectorAll('.light')];
  const visible = new Set();
  const pointer = { x: innerWidth / 2, y: innerHeight / 2, active: false };
  let frame = 0;
  let shadowBudget = 0;
  let animationContext;
  let switchTimer;
  let pointerDirty = false;

  // Shadows settle in place. No idle animation loop and no mouseleave spring-back.
  const render = () => {
    frame = 0;
    header.classList.toggle('is-scrolled', scrollY > 40);
    if (reduced.matches) return;
    const x = Math.max(-1, Math.min(1, (pointer.x / innerWidth - .5) * 2));
    const y = Math.max(-1, Math.min(1, (pointer.y / innerHeight - .5) * 2));
    const amplitude = mobile.matches ? 8 : 24;
    if (window.gsap && pointerDirty) {
      pointerDirty = false;
      lights.forEach((light, i) => gsap.to(light, { x: x * amplitude * (i + 1) / 3, y: y * amplitude * (i + 1) / 3, duration: .9, ease: 'power3.out', overwrite: true }));
    }
    const now = performance.now();
    if (now - shadowBudget < 30) return;
    shadowBudget = now;
    visible.forEach(card => {
      const rect = card.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const centrality = Math.max(0, 1 - Math.abs(cy - innerHeight / 2) / (innerHeight * .7));
      const proximity = pointer.active ? Math.max(0, 1 - Math.hypot(pointer.x - cx, pointer.y - cy) / 650) : 0;
      const float = centrality * .65 + proximity * .35;
      card.style.setProperty('--shadow-x', `${((cx - pointer.x) / innerWidth * 9).toFixed(1)}px`);
      card.style.setProperty('--shadow-y', `${(6 + float * 20).toFixed(1)}px`);
      card.style.setProperty('--shadow-blur', `${(24 + float * 31).toFixed(1)}px`);
      card.style.setProperty('--shadow-alpha', (.035 + float * (card.classList.contains('hero-window') ? .24 : .07)).toFixed(3));
    });
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(render); };
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => entry.isIntersecting ? visible.add(entry.target) : visible.delete(entry.target));
    schedule();
  }, { rootMargin: '50px' });
  cards.forEach(card => {
    observer.observe(card);
    card.addEventListener('pointermove', event => {
      if (reduced.matches || !finePointer.matches) return;
      const rect = card.getBoundingClientRect();
      card.style.setProperty('--spot-x', `${event.clientX - rect.left}px`);
      card.style.setProperty('--spot-y', `${event.clientY - rect.top}px`);
      card.classList.add('is-hovered');
    }, { passive: true });
    card.addEventListener('pointerleave', () => card.classList.remove('is-hovered'));
  });
  window.addEventListener('pointermove', event => {
    if (reduced.matches || !finePointer.matches) return;
    pointer.x = event.clientX; pointer.y = event.clientY; pointer.active = true; pointerDirty = true; schedule();
  }, { passive: true });
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(frame); frame = 0; }
    else schedule();
  });

  // Two real renderer previews, with accessible toggle state and a static fallback.
  const buttons = [...document.querySelectorAll('[data-appearance]')];
  buttons.forEach(button => button.addEventListener('click', () => {
    if (button.getAttribute('aria-pressed') === 'true') return;
    const appearance = button.dataset.appearance;
    buttons.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    document.querySelectorAll('[data-image]').forEach(img => {
      const active = img.dataset.image === appearance;
      img.classList.toggle('is-active', active);
      img.setAttribute('aria-hidden', String(!active));
    });
    document.querySelector('#appearance-description').textContent = appearance === 'liquid'
      ? '液态玻璃：通透的侧边栏与顶栏，让界面多一点呼吸。'
      : '经典：清晰、轻巧的浅色界面。相同的连接能力，熟悉的使用体验。';
    const showcase = document.querySelector('.showcase-window');
    clearTimeout(switchTimer);
    showcase.classList.remove('is-switching');
    if (!reduced.matches) {
      void showcase.offsetWidth;
      showcase.classList.add('is-switching');
      switchTimer = setTimeout(() => showcase.classList.remove('is-switching'), 650);
    }
  }));

  const setupMotion = () => {
    animationContext?.revert();
    cards.forEach(card => card.classList.remove('is-hovered'));
    if (reduced.matches || !window.gsap || !window.ScrollTrigger) {
      lights.forEach(light => light.style.removeProperty('transform'));
      schedule(); return;
    }
    gsap.registerPlugin(ScrollTrigger);
    animationContext = gsap.context(() => {
      // One-off confluence; content is never covered by an intro screen.
      gsap.fromTo('.river', { strokeDasharray: 1800, strokeDashoffset: 1800, opacity: .7 }, { strokeDashoffset: 0, opacity: .45, duration: 2.2, ease: 'power3.inOut', stagger: 0 });
      document.querySelectorAll('section').forEach(section => {
        const elements = section.querySelectorAll('[data-reveal]');
        if (!elements.length) return;
        gsap.from(elements, { y: 32, opacity: 0, duration: .6, ease: 'power2.out', stagger: .1, scrollTrigger: { trigger: section, start: 'top 85%', once: true } });
      });
      // Hero top meets viewport top -> quickstart top meets viewport center.
      gsap.to('.hero-product', { y: () => -Math.min(48, innerHeight * .1), scale: .97, ease: 'none', scrollTrigger: { trigger: '#hero', start: 'top top', endTrigger: '#quickstart', end: 'top center', scrub: .6, invalidateOnRefresh: true } });
    });
    schedule();
  };
  reduced.addEventListener('change', setupMotion);
  setupMotion();
  schedule();
})();
