export function typingDots(label: string, className: string) {
  const status = document.createElement('span');
  status.className = className;
  status.setAttribute('role', 'status');
  const accessible = document.createElement('span');
  accessible.className = 'sr-only';
  accessible.textContent = label;
  status.append(accessible);
  for (let dot = 0; dot < 3; dot++) {
    const element = document.createElement('i');
    element.setAttribute('aria-hidden', 'true');
    status.append(element);
  }
  return status;
}
