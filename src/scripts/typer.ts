/* Conversa de demonstração: escreve-se uma vez quando entra no ecrã. Nunca em loop. */
const box = document.querySelector<HTMLElement>('[data-typer]');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

if (box && !reduced && 'IntersectionObserver' in window) {
  const items = Array.from(box.querySelectorAll<HTMLElement>('.dm'));
  items.forEach((li) => li.classList.add('is-pending'));
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const play = async () => {
    for (const li of items) {
      const ai = li.classList.contains('is-ai');
      await wait(ai ? 350 : 650);
      if (ai) {
        li.classList.add('is-typing');
        await wait(Math.min(1500, 500 + li.textContent!.length * 9));
        li.classList.remove('is-typing');
      }
      li.classList.remove('is-pending');
      li.classList.add('is-shown');
    }
  };

  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        play();
      }
    },
    { threshold: 0.35 },
  );
  io.observe(box);
}
