// Remove all tooltips dynamically
const observer = new MutationObserver(() => {
    document
        .querySelectorAll("[title]")
        .forEach((el) => el.removeAttribute("title"));
});
observer.observe(document.body, { childList: true, subtree: true });
