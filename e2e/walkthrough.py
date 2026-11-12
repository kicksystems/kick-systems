# Clicks through the app as each type of user and saves screenshots.
import re, sys
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3100"
OUT = sys.argv[1]
fails = []

def check(name, ok):
    print(("PASS  " if ok else "FAIL  ") + name)
    if not ok: fails.append(name)

def login(page, name):
    page.context.clear_cookies()
    page.goto(BASE + "/login")
    page.get_by_role("button", name=re.compile(name)).click()
    page.wait_for_url(BASE + "/")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    page = b.new_page(viewport={"width": 1440, "height": 1000})

    page.goto(BASE + "/login"); page.screenshot(path=f"{OUT}/01-login.png")

    # Admin: create RAPID DNA as a copy of PEKS, add an episode, put Cristianne on it.
    login(page, "Regis Terencio")
    page.screenshot(path=f"{OUT}/02-admin-home.png", full_page=True)
    page.goto(BASE + "/admin/projects")
    page.fill("input[name=name]", "RAPID DNA")
    page.select_option("select[name=copy_from]", label="Copy structure of PEKS")
    page.get_by_role("button", name="Create project").click()
    page.wait_for_url(re.compile(r"/admin/projects/[0-9a-f-]{36}$"))
    page.fill("input[name=code]", "101")
    page.get_by_role("button", name="Add episode").click()
    page.wait_for_url(re.compile(r"saved=1"))
    check("RAPID DNA copied with 13 statuses", page.locator("input[name=name][aria-label='Status name']").count() == 14)  # 13 + empty "new" row
    page.screenshot(path=f"{OUT}/03-project-settings.png", full_page=True)

    page.goto(BASE + "/admin/users")
    row = page.locator("details", has_text="Cristianne Ly")
    row.locator("summary").click()
    row.get_by_label("RAPID DNA").check()
    row.get_by_role("button", name="Save").click()
    page.wait_for_url(re.compile(r"saved=1"))
    page.screenshot(path=f"{OUT}/04-people.png", full_page=True)

    # Admin adds a new person
    page.locator("summary", has_text="Add a person").click()
    form = page.locator("details", has_text="Add a person")
    form.locator("input[name=full_name]").fill("Renan Rossi")
    form.locator("input[name=email]").fill("renan@example.test")
    form.locator("input[name=projects]").first.check()
    form.get_by_role("button", name="Add person").click()
    page.wait_for_url(re.compile(r"added=1"))
    check("admin can add a person", page.locator("summary", has_text="Renan Rossi").count() == 1)

    # Artist in PEKS only
    login(page, "Hugo Benchimol")
    side = page.locator("aside").inner_text()
    check("Hugo's menu shows PEKS", "PEKS" in side)
    check("Hugo's menu hides RAPID DNA", "RAPID DNA" not in side)
    check("Hugo's menu hides admin pages", "Admin notes" not in side and "Reports" not in side and "People" not in side)
    page.screenshot(path=f"{OUT}/05-artist-hugo.png", full_page=True)
    page.goto(BASE + "/admin/users")
    check("artist sent away from People page", page.url == BASE + "/")

    # Artist in RAPID DNA only
    login(page, "Cristianne Ly")
    side = page.locator("aside").inner_text()
    check("Cristianne sees RAPID DNA", "RAPID DNA" in side)
    check("Cristianne does not see PEKS", "PEKS" not in side.replace("RAPID DNA", ""))
    page.screenshot(path=f"{OUT}/06-artist-cristianne.png", full_page=True)

    # Client
    login(page, "Magical Elves")
    side = page.locator("aside").inner_text()
    check("client sees only Shot Tracker and Visual Guides", "Treinamento" not in side and "SHOT TRACKER" in side.upper())
    page.screenshot(path=f"{OUT}/07-client.png", full_page=True)

    # Observer
    login(page, "Melina Salles")
    side = page.locator("aside").inner_text()
    check("observer sees admin notes but not Reports", "Admin notes" in side and "Reports" not in side)
    page.screenshot(path=f"{OUT}/08-observer.png", full_page=True)

    # Client opening a page link they shouldn't see
    login(page, "Regis Terencio")
    href = page.locator("aside a", has_text="Admin notes").first.get_attribute("href")
    login(page, "Magical Elves")
    page.goto(BASE + href)
    check("client gets 'not found' on an admin page link", "404" in page.content() or "could not be found" in page.content())

    # Phone width
    page.set_viewport_size({"width": 390, "height": 844})
    login(page, "Hugo Benchimol")
    page.screenshot(path=f"{OUT}/09-phone.png", full_page=True)
    b.close()

print(f"\n{len(fails)} failed" if fails else "\nAll walkthrough checks passed.")
sys.exit(1 if fails else 0)
