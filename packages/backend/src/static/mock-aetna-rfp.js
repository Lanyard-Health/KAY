/* ─── tiny state ─── */
const S = { requestId: null, confirmationNumber: null };
const app = document.getElementById('app');

/* ─── overlay helpers (mimic Angular Material CDK) ─── */
function closeOverlays() { document.querySelectorAll('.cdk-overlay-pane.opt-pane').forEach(e => e.remove()); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeOverlays(); });

function wireMatSelects(root) {
  root.querySelectorAll('mat-select').forEach(ms => {
    if (!ms.querySelector('.placeholder')) {
      const ph = document.createElement('span'); ph.className = 'placeholder';
      ph.textContent = ms.getAttribute('data-label') || 'Select...'; ms.appendChild(ph);
    }
    ms.addEventListener('click', ev => {
      ev.stopPropagation(); closeOverlays();
      const pane = document.createElement('div'); pane.className = 'cdk-overlay-pane opt-pane';
      ms.scrollIntoView({ block: 'center' });
      const r = ms.getBoundingClientRect();
      // Clamp so the pane always stays inside the viewport (fixed positioning).
      const top = Math.max(8, Math.min(r.bottom + 4, window.innerHeight - 328));
      pane.style.left = Math.max(8, r.left) + 'px'; pane.style.top = top + 'px';
      (ms.getAttribute('data-options') || '').split('|').forEach(txt => {
        const o = document.createElement('mat-option');
        o.textContent = txt;
        const cur = (ms.getAttribute('data-selected') || '').split('|');
        o.setAttribute('aria-selected', cur.includes(txt) ? 'true' : 'false');
        o.addEventListener('click', oe => {
          oe.stopPropagation();
          const multi = ms.getAttribute('data-multi') === 'true';
          let sel = (ms.getAttribute('data-selected') || '').split('|').filter(Boolean);
          if (multi) {
            sel = sel.includes(txt) ? sel.filter(x => x !== txt) : sel.concat(txt);
          } else { sel = [txt]; closeOverlays(); }
          ms.setAttribute('data-selected', sel.join('|'));
          o.setAttribute('aria-selected', sel.includes(txt) ? 'true' : 'false');
          ms.querySelector('.placeholder').textContent = sel.join(', ') || 'Select...';
        });
        pane.appendChild(o);
      });
      document.body.appendChild(pane);
    });
  });
}

function wireRadioGroups(root) {
  root.querySelectorAll('mat-radio-group').forEach(g => {
    g.querySelectorAll('span.opt').forEach(sp => {
      sp.addEventListener('click', () => {
        g.querySelectorAll('span.opt').forEach(x => x.classList.remove('sel'));
        sp.classList.add('sel');
        const inp = g.querySelector('input[type=radio][aria-label="' + sp.textContent + '"]');
        if (inp) inp.checked = true;
        g.dispatchEvent(new CustomEvent('picked', { detail: sp.textContent }));
      });
    });
    g.querySelectorAll('input[type=radio]').forEach(inp => {
      inp.addEventListener('click', () => {
        g.querySelectorAll('span.opt').forEach(x =>
          x.classList.toggle('sel', x.textContent === inp.getAttribute('aria-label')));
        g.dispatchEvent(new CustomEvent('picked', { detail: inp.getAttribute('aria-label') }));
      });
    });
  });
}

function render(html, after) {
  closeOverlays();
  app.innerHTML = html;
  wireMatSelects(app); wireRadioGroups(app);
  if (after) after();
  window.scrollTo(0, 0);
}

/* radio pair helper: hidden inputs give getByRole('radio') targets, spans give getByText targets */
const yn = (fcn, extraIdYes, extraIdNo) => `
  <mat-radio-group formcontrolname="${fcn}">
    <input type="radio" style="position:absolute;opacity:0" name="${fcn}" ${extraIdYes ? `id="${extraIdYes}"` : ''} aria-label="Yes">
    <input type="radio" style="position:absolute;opacity:0" name="${fcn}" ${extraIdNo ? `id="${extraIdNo}"` : ''} aria-label="No">
    <span class="opt">Yes</span><span class="opt">No</span>
  </mat-radio-group>`;

const STATES = ["Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan","Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada","New Hampshire","New Jersey","New Mexico","New York","North Carolina","North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island","South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont","Virginia","Washington","West Virginia","Wisconsin","Wyoming"];
const opts = a => a.map(x => `<option>${x}</option>`).join('');

/* ─── STEP 1: gate ─── */
function stepGate() {
  render(`
    <h2>Request for participation</h2>
    <div class="banner">This is a local replica of Aetna's wizard used for workflow testing.</div>
    <div class="field"><label class="f">I would like to join</label>
      <select id="typeOfRFP"><option value="">Select</option><option>Aetna</option><option>Banner|Aetna</option><option>Texas Health Aetna</option></select></div>
    <div class="field"><label class="f">I am applying for</label>
      <select id="typeOfRFP1"><option value="">Select</option><option>Behavioral Health</option><option>Medical</option><option>Dental</option></select></div>
    <div class="field"><label class="f">I am joining as</label>
      <select id="typeOfRFP2"><option value="">Select</option><option>A individual provider applying under a SSN or TaxID/EIN that is not currently participating with Aetna</option><option>A provider group applying under a SSN or TaxID/EIN that is not currently participating with Aetna</option><option>A provider applying under a SSN or TaxID/EIN that is currently participating with Aetna</option></select></div>
    <button id="c">Continue</button>
  `, () => document.getElementById('c').onclick = stepSubmitter);
}

/* ─── STEP 2: submitter ─── */
function stepSubmitter() {
  render(`
    <h2>Tell us about yourself</h2>
    <div class="field"><label class="f">Last name</label><input type="text" id="lastName"></div>
    <div class="field"><label class="f">First name</label><input type="text" id="firstName"></div>
    <div class="field"><label class="f">Your role</label>
      <select id="role"><option value="">Select</option>
        <option>Provider</option>
        <option>Credentialing / Enrollment (Director, Manager, Coordinator)</option>
        <option>Office Manager</option><option>Billing</option><option>Other</option></select></div>
    <div class="field"><label class="f">Email</label><input type="email" id="email"></div>
    <div class="field"><label class="f">Verify email</label><input type="email" id="verifyEmail"></div>
    <div class="field"><label class="f">Phone number</label><input type="text" id="phoneNumber"></div>
    <div class="field"><label class="f">Your NPI</label><input type="text" id="npi"></div>
    <div class="field"><a class="text-links">EMAIL ACKNOWLEDGEMENT</a>
      <div class="note">Review the acknowledgement to enable Agree.</div></div>
    <mat-radio-group formcontrolname="emailAck">
      <input type="radio" style="position:absolute;opacity:0" name="emailAck" aria-label="Agree">
      <input type="radio" style="position:absolute;opacity:0" name="emailAck" aria-label="Disagree">
      <span class="opt">Agree</span><span class="opt">Disagree</span>
    </mat-radio-group>
    <div class="field"><input type="checkbox" id="checkboxSelect"> <label for="checkboxSelect">I certify the above information is accurate.</label></div>
    <button id="c">Continue</button>
  `, () => document.getElementById('c').onclick = stepNetworkCheck);
}

/* ─── STEP 3: network check ─── */
function stepNetworkCheck() {
  render(`
    <h2>Step 1 &mdash; Network check</h2>
    <div class="field"><label class="f">Do you offer telehealth services?</label>${yn('teleHealthService')}</div>
    <div class="field" id="teleServicesWrap" style="display:none"><label class="f">I provide</label>
      <select id="teleServices"><option value="">Select</option><option>Telehealth only services</option><option>Hybrid services</option><option>In-person only services</option></select></div>
    <div class="field"><label class="f">Network you are joining</label>
      <select id="networkJoining"><option>Commercial and Medicare</option><option>Commercial only</option></select></div>
    <div class="field"><label class="f">Which situation applies to you?</label>
      <select id="applicableSituation"><option value="">Select</option><option>I want to be contracted in the state selected below</option><option>Other situation</option></select></div>
    <div class="field"><label class="f">State</label><select id="state"><option value="">Select</option>${opts(STATES)}</select></div>
    <div class="field"><label class="f">ZIP code</label><input type="text" id="zipCode"></div>
    <div class="field"><label class="f">Tax ID type</label>
      <select id="taxIdType"><option value="">Select</option><option>E - Employer identification number</option><option>S - Social Security number</option></select></div>
    <div class="field"><label class="f">Name associated with tax ID</label><input type="text" id="taxIDName"></div>
    <div class="field"><label class="f">Tax ID</label><input type="text" id="taxId"></div>
    <div class="field"><label class="f">Verify tax ID</label><input type="text" id="verifyTaxID"></div>
    <div class="field"><label class="f">Practitioner last name</label><input type="text" id="practLastName"></div>
    <div class="field"><label class="f">Practitioner first name</label><input type="text" id="practFirstName"></div>
    <div class="field"><label class="f">Practitioner NPI</label><input type="text" id="npi"></div>
    <div class="field"><input type="checkbox" id="checkboxSelect"> <label for="checkboxSelect">I certify the above information is accurate.</label></div>
    <button id="c">Continue</button>
  `, () => {
    app.querySelector('mat-radio-group[formcontrolname="teleHealthService"]')
       .addEventListener('picked', e => {
         document.getElementById('teleServicesWrap').style.display = e.detail === 'Yes' ? '' : 'none';
       });
    document.getElementById('c').onclick = stepParticipationInterstitial;
  });
}

/* ─── STEP 3b: participation interstitial (overlay) ─── */
function stepParticipationInterstitial() {
  render(`
    <h2>Step 1 &mdash; Network check</h2>
    <p class="note">Reviewing existing participation&hellip;</p>
    <div class="cdk-overlay-pane overlay-center">
      <h2>Existing participation</h2>
      <p>Do any of the following apply to the practitioner?</p>
      <div class="field"><input type="checkbox" id="Currently participating"> <label>Currently participating with Aetna</label></div>
      <div class="field"><input type="checkbox" id="Previously participated"> <label>Previously participated with Aetna</label></div>
      <div class="field"><input type="checkbox" id="None of the above apply"> <label>None of the above apply</label></div>
      <div class="field"><input type="checkbox" id="checkboxSelect"> <label for="checkboxSelect">I certify the above.</label></div>
      <button id="oc">Continue</button>
    </div>
  `, () => {
    document.getElementById('oc').onclick = async () => {
      const res = await fetch('/api/provider/update/npcheck?sendEmail=YES', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
      });
      const j = await res.json();
      S.requestId = j?.data?.requestId || null;
      stepRequestIdDialog();
    };
  });
}

function stepRequestIdDialog() {
  render(`
    <h2>Step 1 &mdash; Network check</h2>
    <div class="cdk-overlay-pane overlay-center">
      <h2>Application saved</h2>
      <p>Your Request ID is</p>
      <p class="reqid">${S.requestId}</p>
      <p class="note">Keep this number to resume your application later. A confirmation email has been sent.</p>
      <button id="cs">Continue session</button>
    </div>
  `, () => document.getElementById('cs').onclick = stepSpecialty);
}

/* ─── STEP 4: specialty (BH) ─── */
function stepSpecialty() {
  render(`
    <h2>Step 2 &mdash; Specialty details</h2>
    <div class="field"><label class="f">Degree type</label>
      <select id="degreeType"><option value="">Select</option><option>MD</option><option>DO</option><option>PhD</option><option>PsyD</option><option>LCSW</option><option>LPC</option><option>LMFT</option><option>APRN</option></select></div>
    <div class="field"><label class="f">Specialty</label>
      <select id="specialty"><option value="">Select</option><option>Psychiatry</option><option>Addiction Psychiatry</option><option>Child and Adolescent Psychiatry</option><option>Clinical Psychology</option><option>Clinical Social Worker</option><option>Professional Counselor</option><option>Marriage and Family Therapist</option><option>Psychiatric Nurse Practitioner</option></select></div>
    <div class="field"><a class="text-links">Behavioral Health Provider Manual</a>
      <div class="note">Review the manual to enable Agree.</div></div>
    <mat-radio-group formcontrolname="bhManualAck">
      <input type="radio" style="position:absolute;opacity:0" name="bhManualAck" aria-label="Agree">
      <input type="radio" style="position:absolute;opacity:0" name="bhManualAck" aria-label="Disagree">
      <span class="opt">Agree</span><span class="opt">Disagree</span>
    </mat-radio-group>
    <div class="field"><input type="checkbox" id="checkboxSelect"> <label for="checkboxSelect">I certify the above information is accurate.</label></div>
    <button id="c">Continue</button>
  `, () => document.getElementById('c').onclick = stepCaqhModal);
}

/* ─── STEP 5: contacting — CAQH modal then provider info ─── */
function stepCaqhModal() {
  render(`
    <h2>Step 3 &mdash; Contact and contracting</h2>
    <div class="cdk-overlay-pane overlay-center">
      <h2>Credentialing via CAQH</h2>
      <p class="note">Aetna uses CAQH ProView for credentialing. Keep your CAQH profile current and authorized for Aetna.</p>
      <button id="ack">Acknowledge and continue</button>
    </div>
  `, () => document.getElementById('ack').onclick = stepProviderInfo);
}

function stepProviderInfo() {
  render(`
    <h2>Step 3 &mdash; Practitioner information</h2>
    <div class="field"><label class="f">Date of birth (MM/DD/YYYY)</label><input type="text" id="dob"></div>
    <div class="field"><label class="f">Medical license number</label><input type="text" id="medicalLicenseNumber"></div>
    <div class="field"><label class="f">License expiration date (MM/DD/YYYY)</label><input type="text" id="medLicenseExpDate"></div>
    <div class="field"><label class="f">CAQH Provider ID</label><input type="text" id="caqhID"></div>
    <div class="field"><label class="f">Is the practitioner a hospitalist?</label>${yn('hospitalist', 'Yes-input', 'No-input')}</div>
    <div class="field"><label class="f">Does the practitioner use electronic prescribing?</label>${yn('electronicPrescribing', 'electronicPrescribingYes-input', 'electronicPrescribingNo-input')}</div>
    <button id="c">Continue</button>
  `, () => document.getElementById('c').onclick = stepContracting);
}

function stepContracting() {
  render(`
    <h2>Step 3 &mdash; Contracting contact</h2>
    <div class="field"><label class="f">Who should we contact for contracting?</label>
      <mat-radio-group formcontrolname="contractContact">
        <input type="radio" style="position:absolute;opacity:0" name="contractContact" aria-label="Submitter">
        <input type="radio" style="position:absolute;opacity:0" name="contractContact" aria-label="Practitioner">
        <span class="opt">Submitter</span><span class="opt">Practitioner</span>
      </mat-radio-group></div>
    <div class="field"><label class="f">Preferred contact method</label><br>
      <input type="checkbox" id="EmailSub-input"> <label for="EmailSub-input">Email</label>
      &nbsp; <input type="checkbox" id="PhoneSub-input"> <label for="PhoneSub-input">Phone</label></div>
    <div class="field"><label class="f">Who is authorized to sign the agreement?</label>
      <mat-radio-group formcontrolname="authRadioGroup">
        <input type="radio" style="position:absolute;opacity:0" name="authRadioGroup" aria-label="Submitter">
        <input type="radio" style="position:absolute;opacity:0" name="authRadioGroup" aria-label="Practitioner">
        <span class="opt">Submitter</span><span class="opt">Practitioner</span>
      </mat-radio-group></div>
    <button id="c">Continue</button>
  `, () => document.getElementById('c').onclick = stepLocation);
}

/* ─── STEP 6: location ─── */
function stepLocation() {
  render(`
    <h2>Step 4 &mdash; Primary service location</h2>
    <div class="field"><label class="f">Place of service</label>
      <mat-radio-group formcontrolname="placeOfService">
        <input type="radio" style="position:absolute;opacity:0" name="pos" aria-label="Office based">
        <input type="radio" style="position:absolute;opacity:0" name="pos" aria-label="Hospital / facility based">
        <span class="opt">Office based</span><span class="opt">Hospital / facility based</span>
      </mat-radio-group></div>
    <div class="field"><label class="f">Street address</label><input type="text" id="street"></div>
    <div class="field"><label class="f">City</label><input type="text" id="city"></div>
    <div class="field"><label class="f">Phone</label><input type="text" id="phoneNumber"></div>
    <div class="field"><label class="f">Fax</label><input type="text" id="faxNumber"></div>
    <div class="field"><label class="f">Languages spoken by office staff</label>
      <input type="text" formcontrolname="staffLanguage" placeholder="Type a language and press Enter"></div>
    <div class="field"><label class="f">Languages supported by interpreter</label>
      <input type="text" formcontrolname="interpreterLanguage" placeholder="Type a language and press Enter"></div>
    <div class="field"><label class="f">Does this location charge a facility fee?</label>${yn('facilityFee')}</div>
    <div class="field"><label class="f">Is this location ADA accessible?</label>
      <mat-radio-group formcontrolname="locationSpecific">
        <input type="radio" style="position:absolute;opacity:0" name="ada" id="locationSpecific_yes-input" aria-label="Yes">
        <input type="radio" style="position:absolute;opacity:0" name="ada" id="locationSpecific_no-input" aria-label="No">
        <span class="opt">Yes</span><span class="opt">No</span>
      </mat-radio-group></div>
    <div class="field"><label class="f">Access accommodations</label><input type="text" id="accessAccommodations"></div>
    <hr>
    <div class="field"><label class="f">Telehealth services at this location?</label>${yn('telehealthLocation')}</div>
    <div id="teleBlock" style="display:none">
      <div class="field"><label class="f">Services provided</label>
        <select id="teleServicesLoc"><option value="">Select</option><option>Telehealth only services</option><option>Hybrid services</option><option>In-person only services</option></select></div>
      <div class="field"><label class="f">Telehealth service methods</label>
        <mat-select data-multi="true" data-label="Select methods" data-options="Video Conference|Telephone|Text / Chat|Remote Patient Monitoring"></mat-select></div>
      <div class="field"><label class="f">Telehealth service types</label>
        <mat-select data-multi="true" data-label="Select types" data-options="Behavioral Health Services|Primary Care Services|Specialty Care Services|Urgent Care Services"></mat-select></div>
      <div class="field"><label class="f">Is the telehealth platform HIPAA compliant?</label>${yn('hipaaCompliant')}</div>
    </div>
    <button id="c">Continue</button>
  `, () => {
    app.querySelector('mat-radio-group[formcontrolname="telehealthLocation"]')
       .addEventListener('picked', e => {
         document.getElementById('teleBlock').style.display = e.detail === 'Yes' ? '' : 'none';
         wireMatSelects(document.getElementById('teleBlock'));
       });
    document.getElementById('c').onclick = stepAddresses;
  });
}

/* ─── STEP 7: addresses ─── */
function stepAddresses() {
  render(`
    <h2>Step 4 &mdash; Mailing &amp; billing addresses</h2>
    <div class="field"><label class="f">Mailing address</label>
      <mat-radio-group formcontrolname="mailingAddress">
        <input type="radio" style="position:absolute;opacity:0" name="mail" id="Same as primary service location address-input" aria-label="Same as primary service location address">
        <input type="radio" style="position:absolute;opacity:0" name="mail" aria-label="Different address">
        <span class="opt">Same as primary service location address</span><span class="opt">Different address</span>
      </mat-radio-group></div>
    <div class="field"><label class="f">Billing address</label>
      <mat-radio-group formcontrolname="billingAddress">
        <input type="radio" style="position:absolute;opacity:0" name="bill" id="Same as primary service location address -input" aria-label="Same as primary service location address ">
        <input type="radio" style="position:absolute;opacity:0" name="bill" aria-label="Different address">
        <span class="opt">Same as primary service location address</span><span class="opt">Different address</span>
      </mat-radio-group></div>
    <div class="field"><label class="f">Do you have additional service locations?</label>
      <mat-radio-group formcontrolname="additionalServiceRadio">
        <input type="radio" style="position:absolute;opacity:0" name="addl" id="additionalServiceRadio_yes-input" aria-label="Yes">
        <input type="radio" style="position:absolute;opacity:0" name="addl" id="additionalServiceRadio_no-input" aria-label="No">
        <span class="opt">Yes</span><span class="opt">No</span>
      </mat-radio-group></div>
    <button id="c">Continue</button>
  `, () => document.getElementById('c').onclick = stepOther);
}

/* ─── STEP 8: other info + W9 ─── */
function stepOther() {
  render(`
    <h2>Step 5 &mdash; Other information</h2>
    <div class="field"><label class="f">Hospital admitting privileges?</label>${yn('hospitalAdmittingPrivileges')}</div>
    <div class="field"><label class="f">Facility admitting privileges?</label>${yn('facilityAdmittingPrivileges')}</div>
    <div class="field"><label class="f">Attach your W9 (PDF)</label><br>
      <input type="file" id="w9file">
      <div class="note" id="w9status">No file attached.</div></div>
    <button id="c">Continue</button>
  `, () => {
    document.getElementById('w9file').addEventListener('change', e => {
      const f = e.target.files[0];
      document.getElementById('w9status').textContent = f ? ('Attached: ' + f.name + ' (' + f.size + ' bytes)') : 'No file attached.';
    });
    document.getElementById('c').onclick = stepBH;
  });
}

/* ─── STEP 9: behavioral health ─── */
function stepBH() {
  render(`
    <h2>Step 6 &mdash; Behavioral health details</h2>
    <div class="field"><label class="f">Age groups treated</label>
      <mat-select id="ageGroupsDropdown" data-multi="true" data-label="Select age groups" data-options="Children Ages: 0-12|Adolescents Ages: 13-17|Adults Ages: 18-64|Geriatrics Ages: 65 and up"></mat-select></div>
    <div class="field"><label class="f">Medicare certified?</label>${yn('medicareCertified')}</div>
    <div class="field"><label class="f">Medicare PTAN</label><input type="text" id="ptan"></div>
    <div class="field"><label class="f">Medicaid certified?</label>${yn('medicadCertified')}</div>
    <div class="field"><label class="f">Participate in the Aetna EAP program?</label>${yn('aetnaEAPProgram')}</div>
    <div class="field"><label class="f">American Sign Language offered?</label>${yn('americanSignLang')}</div>
    <div class="field"><label class="f">Languages spoken by provider</label>
      <input type="text" formcontrolname="providerLanguage" placeholder="Type a language and press Enter"></div>
    <div class="field"><label class="f">Practice focus</label>
      <mat-select id="practiceFocusDropdown" data-multi="true" data-label="Select practice focus" data-options="Individual Therapy|Group Therapy|Family Therapy|Medication Management|Substance Use Disorder|Eating Disorders"></mat-select></div>
    <button id="c">Continue</button>
  `, () => document.getElementById('c').onclick = stepReview);
}

/* ─── STEP 10: review + final submit ─── */
function stepReview() {
  render(`
    <h2>Review your request</h2>
    <table class="summary">
      <tr><td>Request ID</td><td class="reqid">${S.requestId}</td></tr>
      <tr><td>Applying for</td><td>Behavioral Health &mdash; individual provider</td></tr>
      <tr><td>Status</td><td>Ready to submit</td></tr>
    </table>
    <p class="note">Clicking submit files your request for participation with Aetna. (MOCK &mdash; nothing real is filed.)</p>
    <button id="sub">Submit request for participation</button>
  `, () => {
    document.getElementById('sub').onclick = async () => {
      const res = await fetch('/api/provider/update/submitrequest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: S.requestId })
      });
      const j = await res.json();
      S.confirmationNumber = j?.data?.confirmationNumber || S.requestId;
      stepConfirmation();
    };
  });
}

function stepConfirmation() {
  render(`
    <h2>Thank you &mdash; your request has been submitted</h2>
    <p>Your Request ID ${S.requestId} has been filed.</p>
    <p>Confirmation number: <span class="reqid">${S.confirmationNumber}</span></p>
    <p class="note">You will receive an email when Aetna completes its review. (MOCK confirmation page.)</p>
  `);
}

stepGate();
