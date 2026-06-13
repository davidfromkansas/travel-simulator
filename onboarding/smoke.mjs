import puppeteer from "puppeteer-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "http://localhost:5173/";

const EXPECTED_KEYS = ["name", "nationality", "occupation", "interests", "travelStyle", "languages"];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox", "--window-size=1280,900"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });

const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

function ok(label, cond) {
  console.log(`${cond ? "✅" : "❌"} ${label}`);
  if (!cond) process.exitCode = 1;
}

// Fresh load => onboarding
await page.evaluate(() => localStorage.clear()).catch(() => {});
await page.goto(URL, { waitUntil: "networkidle0" });
await page.reload({ waitUntil: "networkidle0" });

ok("onboarding form renders", await page.$(".onboarding") !== null);
await page.screenshot({ path: "/tmp/sim-1-onboarding.png" });

// Submit the form (defaults are prefilled) -> globe
await page.click(".primary");
await new Promise((r) => setTimeout(r, 1500));

// Verify CONTRACT #1 schema exactly
const profile = await page.evaluate(() => JSON.parse(localStorage.getItem("playerProfile")));
ok("profile saved to localStorage", !!profile);
ok("profile has exact top-level keys", JSON.stringify(Object.keys(profile).sort()) === JSON.stringify([...EXPECTED_KEYS].sort()));
ok("interests is array", Array.isArray(profile.interests));
ok("languages.native is array", Array.isArray(profile.languages?.native));
ok("languages.learning is string", typeof profile.languages?.learning === "string");
ok("level is beginner|advanced", ["beginner", "advanced"].includes(profile.languages?.level));
console.log("   profile:", JSON.stringify(profile));

ok("globe canvas mounts", await page.$(".globe-wrap canvas") !== null);
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: "/tmp/sim-2-globe.png" });

// CONTRACT #2: fire the real handoff seam. Italy has a town => mounts in-page.
await page.evaluate(() => window.enterCountry("italy"));
await new Promise((r) => setTimeout(r, 1000));
ok("handoff -> town iframe mounts", await page.$(".townframe .town-iframe") !== null);
const frameSrc = await page.$eval(".town-iframe", (el) => el.getAttribute("src"));
ok("town iframe points at world build (:5174)", /:5174/.test(frameSrc));
ok("town iframe carries country=italy", /[?&]country=italy/.test(frameSrc));
ok("town iframe carries the profile", /[?&]profile=/.test(frameSrc) && /Italian/.test(decodeURIComponent(frameSrc)));
const selected = await page.evaluate(() => localStorage.getItem("selectedCountry"));
ok("selectedCountry persisted = italy", selected === "italy");
const learning = await page.evaluate(() => JSON.parse(localStorage.getItem("playerProfile")).languages.learning);
ok("learning synced to Italy => Italian", learning === "Italian");
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: "/tmp/sim-3-town.png" });

// A country WITHOUT a town still gets the placeholder scene.
await page.evaluate(() => window.enterCountry("japan"));
await new Promise((r) => setTimeout(r, 600));
ok("country w/o town -> placeholder scene", await page.$(".scene") !== null);
await page.evaluate(() => window.enterCountry("italy"));
await new Promise((r) => setTimeout(r, 800));

// Refresh preserves profile
await page.reload({ waitUntil: "networkidle0" });
const after = await page.evaluate(() => localStorage.getItem("playerProfile"));
ok("refresh preserves profile", !!after);

ok("no console/page errors", errors.length === 0);
if (errors.length) console.log("   ERRORS:\n   " + errors.join("\n   "));

await browser.close();
console.log(process.exitCode ? "\nSMOKE FAILED" : "\nSMOKE PASSED");
