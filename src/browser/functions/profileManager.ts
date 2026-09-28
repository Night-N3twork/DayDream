import type { ProfileManagerInterface } from "./types";
import { ProfilesAPI } from "@apis/profiles";
import { Logger } from "@apis/logging";
import { Items } from "@browser/items";
import { Protocols } from "@browser/protocols";
import { Nightmare as UI } from "@pkgs/Nightmare";
import { ModalUtilities } from "./modalUtilities";
import { createIcons, UserPlus, Settings, Download, Save, ArrowRight, Trash2, Users, AlertCircle, Info, Upload, Trash, X } from "lucide";
import { checkNightPlusStatus } from "@apis/nightplus";
import { resolvePath } from "@utils/basepath";

export class ProfileManager implements ProfileManagerInterface {
  private profiles: ProfilesAPI;
  private logger: Logger;
  private items: Items;
  private proto: Protocols;
  private ui: UI;
  private nightmarePlugins: any | null;
  private modalUtilities: ModalUtilities;

  constructor(
    profiles: ProfilesAPI,
    logger: Logger,
    items: Items,
    proto: Protocols,
    ui: UI,
    nightmarePlugins: any,
    modalUtilities: ModalUtilities,
  ) {
    this.profiles = profiles;
    this.logger = logger;
    this.items = items;
    this.proto = proto;
    this.ui = ui;
    this.nightmarePlugins = nightmarePlugins;
    this.modalUtilities = modalUtilities;
  }

  async profilesMenu(button: HTMLButtonElement): Promise<void> {
    const profilesList = await this.profiles.listProfiles();
    const currentProfile = this.profiles.getCurrentProfile();
    const footerActions = await this.createFooterActions(profilesList.length);

    const content = this.ui.createElement(
      "div",
      {
        class: "profile-manager-menu",
        style: `
        min-width: 320px; 
        max-width: 400px; 
        background: var(--bg-2); 
        border: 1px solid var(--white-10); 
        padding: 0;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      `,
      },
      [
        this.ui.createElement(
          "div",
          {
            class: "flex items-center justify-between p-4 border-b",
            style: "border-bottom: 1px solid var(--white-10);",
          },
          [
            this.ui.createElement(
              "h3",
              {
                style:
                  "color: var(--text); margin: 0; font-size: 16px; font-weight: 600;",
              },
              ["Profile Manager"],
            ),

            this.ui.createElement(
              "div",
              {
                class: "flex items-center gap-2",
              },
              [
                this.ui.createElement(
                  "button",
                  {
                    class:
                      "flex items-center justify-center w-8 h-8 rounded-md hover:bg-opacity-80",
                    style:
                      "background: var(--main); color: var(--bg-1); border: none;",
                    title: "Create New Profile",
                    onclick: () => this.showCreateProfileDialog(),
                  },
                  [
                    this.ui.createElement(
                      "i",
                      {
                        "data-lucide": "user-plus",
                        style: "width: 16px; height: 16px;",
                      },
                      [],
                    ),
                  ],
                ),

                this.ui.createElement(
                  "button",
                  {
                    class:
                      "flex items-center justify-center w-8 h-8 rounded-md",
                    style:
                      "color: var(--text); border: none; background: var(--white-05);",
                    title: "Profile Settings",
                    onclick: async () => {
                      const url =
                        (await this.proto.processUrl("ddx://settings/")) ||
                        resolvePath("internal/error/");
                      const iframe = this.items.frameContainer!.querySelector(
                        "iframe.active",
                      ) as HTMLIFrameElement | null;

                      if (!iframe) {
                        console.warn(
                          "No active iframe found for profile settings navigation",
                        );
                        return;
                      }

                      iframe.setAttribute("src", url);
                    },
                  },
                  [
                    this.ui.createElement(
                      "i",
                      {
                        "data-lucide": "settings",
                        style: "width: 16px; height: 16px;",
                      },
                      [],
                    ),
                  ],
                ),
              ],
            ),
          ],
        ),

        ...(currentProfile
          ? [
              this.ui.createElement(
                "div",
                {
                  class: "p-4 border-b",
                  style: "border-bottom: 1px solid var(--white-10);",
                },
                [
                  this.ui.createElement(
                    "div",
                    {
                      class: "flex items-center justify-between",
                    },
                    [
                      this.ui.createElement(
                        "div",
                        {
                          class: "flex items-center gap-3",
                        },
                        [
                          this.ui.createElement(
                            "div",
                            {
                              class:
                                "w-10 h-10 rounded-full flex items-center justify-center",
                              style:
                                "background: var(--main); color: var(--bg-1); font-weight: 600;",
                            },
                            [currentProfile.charAt(0).toUpperCase()],
                          ),

                          this.ui.createElement("div", {}, [
                            this.ui.createElement(
                              "div",
                              {
                                style:
                                  "color: var(--text); font-size: 14px; font-weight: 500;",
                              },
                              [currentProfile],
                            ),
                            this.ui.createElement(
                              "div",
                              {
                                style:
                                  "color: var(--text); opacity: 0.7; font-size: 12px;",
                              },
                              ["Current Profile"],
                            ),
                          ]),
                        ],
                      ),

                      this.ui.createElement(
                        "div",
                        {
                          class: "flex items-center gap-1",
                        },
                        [
                          this.ui.createElement(
                            "button",
                            {
                              class:
                                "flex items-center justify-center w-6 h-6 rounded",
                              style:
                                "color: var(--text); border: none; background: var(--white-05);",
                              title: "Export Profile",
                              onclick: () => this.exportCurrentProfile(),
                            },
                            [
                              this.ui.createElement(
                                "i",
                                {
                                  "data-lucide": "download",
                                  style: "width: 12px; height: 12px;",
                                },
                                [],
                              ),
                            ],
                          ),

                          this.ui.createElement(
                            "button",
                            {
                              class:
                                "flex items-center justify-center w-6 h-6 rounded",
                              style:
                                "color: var(--text); border: none; background: var(--white-05);",
                              title: "Save Profile",
                              onclick: () => this.saveCurrentProfile(),
                            },
                            [
                              this.ui.createElement(
                                "i",
                                {
                                  "data-lucide": "save",
                                  style: "width: 12px; height: 12px;",
                                },
                                [],
                              ),
                            ],
                          ),
                        ],
                      ),
                    ],
                  ),
                ],
              ),
            ]
          : []),

        this.createProfilesList(profilesList, currentProfile),

        footerActions,
      ],
    );

    requestAnimationFrame(() => {
      if ((window as any).lucide && (window as any).lucide.createIcons) {
        (window as any).lucide.createIcons();
      }
    });

    this.nightmarePlugins.sidemenu.attachTo(button, content);
  }

  private createProfilesList(
    profilesList: string[],
    currentProfile: string | null,
  ) {
    return this.ui.createElement(
      "div",
      {
        style: "max-height: 300px; overflow-y: auto;",
      },
      [
        profilesList.length > 0
          ? this.ui.createElement(
              "div",
              {
                class: "p-2",
              },
              [
                this.ui.createElement(
                  "div",
                  {
                    style:
                      "color: var(--text); opacity: 0.7; font-size: 12px; font-weight: 500; margin-bottom: 8px; padding: 0 8px;",
                  },
                  ["Available Profiles"],
                ),

                ...profilesList.map((profileId) =>
                  this.ui.createElement(
                    "div",
                    {
                      class: `profile-row flex items-center justify-between p-2 rounded-md`,
                      style:
                        currentProfile === profileId
                          ? "background: var(--main-20a); border: 1px solid var(--main-35a); cursor: default;"
                          : "border: 1px solid transparent; cursor: pointer;",
                      onmouseenter:
                        currentProfile !== profileId
                          ? (e: Event) => {
                              (e.target as HTMLElement).style.background =
                                "var(--white-05)";
                            }
                          : undefined,
                      onmouseleave:
                        currentProfile !== profileId
                          ? (e: Event) => {
                              (e.target as HTMLElement).style.background =
                                "transparent";
                            }
                          : undefined,
                    },
                    [
                      this.ui.createElement(
                        "div",
                        {
                          class:
                            "flex items-center gap-3 flex-1 cursor-pointer",
                          style:
                            currentProfile === profileId
                              ? "cursor: default;"
                              : "cursor: pointer;",
                          onclick:
                            currentProfile !== profileId
                              ? (e: Event) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  this.switchToProfile(profileId);
                                }
                              : undefined,
                        },
                        [
                          this.ui.createElement(
                            "div",
                            {
                              class:
                                "w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium",
                              style:
                                currentProfile === profileId
                                  ? "background: var(--main); color: var(--bg-1);"
                                  : "background: var(--white-10); color: var(--text);",
                            },
                            [profileId.charAt(0).toUpperCase()],
                          ),

                          this.ui.createElement(
                            "div",
                            {
                              class: "flex-1",
                            },
                            [
                              this.ui.createElement(
                                "div",
                                {
                                  style:
                                    "color: var(--text); font-size: 14px; font-weight: 500;",
                                },
                                [profileId],
                              ),

                              ...(currentProfile === profileId
                                ? [
                                    this.ui.createElement(
                                      "div",
                                      {
                                        style:
                                          "color: var(--main); font-size: 12px;",
                                      },
                                      ["● Active"],
                                    ),
                                  ]
                                : []),
                            ],
                          ),
                        ],
                      ),

                      this.createProfileActions(profileId, currentProfile),
                    ],
                  ),
                ),
              ],
            )
          : this.createEmptyProfilesState(),
      ],
    );
  }

  private createProfileActions(
    profileId: string,
    currentProfile: string | null,
  ) {
    return this.ui.createElement(
      "div",
      {
        class: "profile-actions flex items-center gap-1",
      },
      [
        ...(currentProfile !== profileId
          ? [
              this.ui.createElement(
                "button",
                {
                  class: "flex items-center justify-center w-5 h-5 rounded",
                  style:
                    "color: var(--success); border: none; background: transparent;",
                  title: "Switch to Profile",
                  onclick: (e: Event) => {
                    e.stopPropagation();
                    this.switchToProfile(profileId);
                  },
                },
                [
                  this.ui.createElement(
                    "i",
                    {
                      "data-lucide": "arrow-right",
                      style: "width: 10px; height: 10px;",
                    },
                    [],
                  ),
                ],
              ),
            ]
          : []),

        this.ui.createElement(
          "button",
          {
            class: "flex items-center justify-center w-5 h-5 rounded",
            style: "color: var(--text); border: none; background: transparent;",
            title: "Export Profile",
            onclick: (e: Event) => {
              e.stopPropagation();
              this.exportProfile(profileId);
            },
          },
          [
            this.ui.createElement(
              "i",
              {
                "data-lucide": "download",
                style: "width: 10px; height: 10px;",
              },
              [],
            ),
          ],
        ),

        ...(currentProfile !== profileId
          ? [
              this.ui.createElement(
                "button",
                {
                  class: "flex items-center justify-center w-5 h-5 rounded",
                  style:
                    "color: var(--error); border: none; background: transparent;",
                  title: "Delete Profile",
                  onclick: (e: Event) => {
                    e.stopPropagation();
                    this.deleteProfile(profileId);
                  },
                },
                [
                  this.ui.createElement(
                    "i",
                    {
                      "data-lucide": "trash-2",
                      style: "width: 10px; height: 10px;",
                    },
                    [],
                  ),
                ],
              ),
            ]
          : []),
      ],
    );
  }

  private createEmptyProfilesState() {
    return this.ui.createElement(
      "div",
      {
        class: "p-6 text-center",
      },
      [
        this.ui.createElement(
          "i",
          {
            "data-lucide": "users",
            style:
              "width: 32px; height: 32px; color: var(--text); opacity: 0.4; margin: 0 auto 12px; display: block;",
          },
          [],
        ),
        this.ui.createElement(
          "div",
          {
            style:
              "color: var(--text); font-size: 14px; font-weight: 500; margin-bottom: 4px;",
          },
          ["No Profiles Yet"],
        ),
        this.ui.createElement(
          "div",
          {
            style: "color: var(--text); opacity: 0.7; font-size: 12px;",
          },
          ["Create your first profile to get started"],
        ),
      ],
    );
  }

  private async createFooterActions(profileCount: number = 0) {
    const hasNightPlus = await checkNightPlusStatus();
    const maxProfiles = hasNightPlus ? Infinity : 3;

    return this.ui.createElement(
      "div",
      {
        class: "p-4 border-t",
        style: "border-top: 1px solid var(--white-10);",
      },
      [
        ...(hasNightPlus
          ? []
          : [
              this.ui.createElement(
                "div",
                {
                  class: "mb-3 p-3 rounded-lg",
                  style: `
              background: var(--main-20a);
              border: 1px solid var(--main-35a);
              font-size: 12px;
            `,
                },
                [
                  this.ui.createElement(
                    "div",
                    {
                      class: "flex items-center gap-2",
                    },
                    [
                      this.ui.createElement(
                        "i",
                        {
                          "data-lucide":
                            profileCount >= maxProfiles
                              ? "alert-circle"
                              : "info",
                          style: `width: 14px; height: 14px; color: var(${profileCount >= maxProfiles ? "--error, #ef4444" : "--main"}); flex-shrink: 0;`,
                        },
                        [],
                      ),
                      (() => {
                        const div = this.ui.createElement("div", {
                          style: "color: var(--text); line-height: 1.4;",
                        });
                        div.innerHTML =
                          profileCount >= maxProfiles
                            ? `<strong style="color: var(--error, #ef4444);">Profile Limit Reached (${profileCount}/${maxProfiles})</strong><br/><span style="opacity: 0.9;">Upgrade to <a href="${resolvePath("internal/terms/")}" target="_blank" style="color: var(--main); text-decoration: underline;">Night+</a> for unlimited profiles.</span>`
                            : `<strong style="color: var(--main);">Profiles: ${profileCount}/${maxProfiles}</strong><br/><span style="opacity: 0.9;">${maxProfiles - profileCount} remaining. <a href="${resolvePath("internal/terms/")}" target="_blank" style="color: var(--main); text-decoration: underline;">Upgrade to Night+</a> for unlimited.</span>`;
                        return div;
                      })(),
                    ],
                  ),
                ],
              ),
            ]),

        this.ui.createElement(
          "div",
          {
            class: "flex items-center gap-2",
          },
          [
            this.ui.createElement(
              "button",
              {
                class:
                  "flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md",
                style:
                  "color: var(--text); border: 1px solid var(--white-10); background: transparent; font-size: 12px;",
                title: "Import Profile",
                onclick: () => this.importProfile(),
              },
              [
                this.ui.createElement(
                  "i",
                  {
                    "data-lucide": "upload",
                    style: "width: 14px; height: 14px; margin-right: 6px;",
                  },
                  [],
                ),
                "Import",
              ],
            ),

            this.ui.createElement(
              "button",
              {
                class:
                  "flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md",
                style:
                  "color: var(--text); border: none; background: var(--white-05); font-size: 12px;",
                title: "Clear Current Data",
                onclick: () => this.clearCurrentProfileData(),
              },
              [
                this.ui.createElement(
                  "i",
                  {
                    "data-lucide": "trash",
                    style: "width: 14px; height: 14px; margin-right: 6px;",
                  },
                  [],
                ),
                "Clear Data",
              ],
            ),
          ],
        ),
      ],
    );
  }

  async showCreateProfileDialog(): Promise<void> {
    console.log("[ProfileManager] showCreateProfileDialog called");
    const profilesList = await this.profiles.listProfiles();
    const currentCount = profilesList.length;
    const hasNightPlus = await checkNightPlusStatus();
    const maxProfiles = hasNightPlus ? Infinity : 3;

    const dialog = document.createElement("div");
    dialog.className = "bc-dialog-overlay";
    dialog.style.cssText = `position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.5); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 99999999; opacity: 0; transition: opacity 0.2s ease;`;

    const dialogContent = document.createElement("div");
    dialogContent.className = "bc-dialog-content";
    dialogContent.style.cssText = `background: var(--bg-2); border: 1px solid var(--white-10); border-radius: 12px; padding: 24px; min-width: 400px; max-width: 90vw; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04); transform: scale(0.95); transition: transform 0.2s ease;`;

    const headerDiv = document.createElement("div");
    headerDiv.className = "flex items-center justify-between mb-6";

    const title = document.createElement("h2");
    title.style.cssText =
      "color: var(--text); font-size: 20px; font-weight: 600; margin: 0;";
    title.textContent = "Create New Profile";

    const closeBtn = document.createElement("button");
    closeBtn.className =
      "flex items-center justify-center w-8 h-8 rounded-full hover:bg-opacity-80";
    closeBtn.style.cssText =
      "color: var(--text); background: var(--white-05); border: none; transition: all 0.15s ease;";
    closeBtn.title = "Close";
    closeBtn.innerHTML =
      '<i data-lucide="x" style="width: 16px; height: 16px;"></i>';

    const formElement = document.createElement("form");
    formElement.style.cssText =
      "display: flex; flex-direction: column; gap: 16px;";

    const inputContainer = document.createElement("div");
    inputContainer.style.cssText =
      "display: flex; flex-direction: column; gap: 8px;";

    const label = document.createElement("label");
    label.style.cssText =
      "color: var(--text); font-size: 14px; font-weight: 500;";
    label.textContent = "Profile Name";

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Enter profile name...";
    input.className = "bc-input";
    input.style.cssText = `background: var(--bg-1); border: 1px solid var(--white-10); border-radius: 8px; padding: 12px 16px; color: var(--text); font-size: 14px; outline: none; transition: all 0.15s ease;`;

    const hint = document.createElement("div");
    hint.style.cssText = "color: var(--text); opacity: 0.7; font-size: 12px;";
    hint.textContent =
      "Choose a unique name for your profile. This will help you identify it later.";

    inputContainer.appendChild(label);
    inputContainer.appendChild(input);
    inputContainer.appendChild(hint);
    formElement.appendChild(inputContainer);

    if (!hasNightPlus) {
      const notice = document.createElement("div");
      notice.className = "flex items-start gap-2";
      notice.style.cssText = `padding: 12px; border-radius: 8px; font-size: 12px; ${
        currentCount >= maxProfiles
          ? "background: var(--error-20a, rgba(239, 68, 68, 0.1)); border: 1px solid var(--error-35a, rgba(239, 68, 68, 0.2));"
          : "background: var(--main-20a); border: 1px solid var(--main-35a);"
      }`;

      const icon = document.createElement("i");
      icon.setAttribute(
        "data-lucide",
        currentCount >= maxProfiles ? "alert-circle" : "info",
      );
      icon.style.cssText = `width: 16px; height: 16px; color: ${currentCount >= maxProfiles ? "var(--error, #ef4444)" : "var(--main)"}; margin-top: 2px; flex-shrink: 0;`;

      const textDiv = document.createElement("div");
      textDiv.style.cssText = "color: var(--text);";

      const strong = document.createElement("strong");
      strong.style.cssText = `color: ${currentCount >= maxProfiles ? "var(--error, #ef4444)" : "var(--main)"};`;
      strong.textContent =
        currentCount >= maxProfiles
          ? "Profile Limit Reached"
          : `Profile Count: ${currentCount} / ${maxProfiles}`;

      const p = document.createElement("p");
      p.style.cssText = "margin: 4px 0 0 0; opacity: 0.9;";
      p.textContent =
        currentCount >= maxProfiles
          ? `You've reached the maximum of ${maxProfiles} profiles on the free tier. `
          : `${maxProfiles - currentCount} profile${maxProfiles - currentCount !== 1 ? "s" : ""} remaining on free tier. `;

      const upgradeLink = document.createElement("a");
      upgradeLink.href = resolvePath("internal/terms/");
      upgradeLink.target = "_blank";
      upgradeLink.style.cssText =
        "color: var(--main); text-decoration: underline; margin-left: 4px;";
      upgradeLink.textContent = "Upgrade to Night+";
      p.appendChild(upgradeLink);

      textDiv.appendChild(strong);
      textDiv.appendChild(p);
      notice.appendChild(icon);
      notice.appendChild(textDiv);
      formElement.appendChild(notice);
    }

    const buttonContainer = document.createElement("div");
    buttonContainer.className = "flex items-center justify-end gap-3 mt-4";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "bc-btn-secondary";
    cancelBtn.style.cssText = `background: transparent; border: 1px solid var(--white-10); color: var(--text); padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.15s ease;`;
    cancelBtn.textContent = "Cancel";

    const createBtn = document.createElement("button");
    createBtn.type = "button";
    createBtn.id = "profile-create-btn";
    createBtn.className = "bc-btn-primary";
    createBtn.style.cssText = `background: var(--main); border: none; color: var(--bg-1); padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.15s ease;`;
    createBtn.textContent =
      currentCount >= maxProfiles ? "Profile Limit Reached" : "Create Profile";
    createBtn.disabled = currentCount >= maxProfiles;

    if (currentCount >= maxProfiles) {
      createBtn.style.opacity = "0.5";
      createBtn.style.cursor = "not-allowed";
    }

    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeDialog();
      }
    };

    const closeDialog = () => {
      document.removeEventListener("keydown", handleKeydown);
      dialog.style.opacity = "0";
      dialogContent.style.transform = "scale(0.95)";
      setTimeout(() => {
        if (document.body.contains(dialog)) {
          document.body.removeChild(dialog);
        }
      }, 200);
      createIcons({ icons: { UserPlus, Settings, Download, Save, ArrowRight, Trash2, Users, AlertCircle, Info, Upload, Trash, X } });
    };

    input.addEventListener("focus", (e) => {
      (e.currentTarget as HTMLInputElement).style.borderColor = "var(--main)";
      (e.currentTarget as HTMLInputElement).style.boxShadow =
        "0 0 0 3px var(--main-20a)";
    });

    input.addEventListener("blur", (e) => {
      (e.currentTarget as HTMLInputElement).style.borderColor =
        "var(--white-10)";
      (e.currentTarget as HTMLInputElement).style.boxShadow = "none";
    });

    cancelBtn.addEventListener("mouseenter", () => {
      cancelBtn.style.background = "var(--white-05)";
    });

    cancelBtn.addEventListener("mouseleave", () => {
      cancelBtn.style.background = "transparent";
    });

    cancelBtn.addEventListener("click", closeDialog);

    createBtn.addEventListener("mouseenter", () => {
      if (!createBtn.disabled) {
        createBtn.style.transform = "scale(1.02)";
      }
    });

    createBtn.addEventListener("mouseleave", () => {
      if (!createBtn.disabled) {
        createBtn.style.transform = "scale(1)";
      }
    });

    createBtn.addEventListener("click", async (e) => {
      console.log("[ProfileManager] Create button clicked - START");
      e.preventDefault();
      const button = e.currentTarget as HTMLButtonElement;
      console.log("[ProfileManager] Button disabled:", button.disabled);

      if (button.disabled) {
        console.log("[ProfileManager] Button is disabled, returning");
        return;
      }

      const profileName = input.value.trim();
      console.log("[ProfileManager] Profile name:", profileName);

      if (!profileName) {
        console.log("[ProfileManager] No profile name provided");
        input.style.borderColor = "var(--error)";
        input.focus();
        return;
      }

      try {
        console.log("[ProfileManager] Starting profile creation...");
        button.textContent = "Creating...";
        button.disabled = true;
        button.style.opacity = "0.7";
        button.style.cursor = "not-allowed";
        console.log("[ProfileManager] Button state updated");

        await this.createProfileWithPresetData(profileName);
        console.log("[ProfileManager] Profile created successfully");
        this.logger.createLog(`Created profile: ${profileName}`);

        closeDialog();

        this.modalUtilities.showAlert(
          "Profile created successfully!",
          "success",
        );

        setTimeout(() => {
          document.location.reload();
        }, 1500);
      } catch (error) {
        console.error("[ProfileManager] Failed to create profile:", error);
        this.modalUtilities.showAlert(
          `Failed to create profile: ${error}`,
          "error",
        );
        button.textContent = "Create Profile";
        button.disabled = false;
        button.style.opacity = "1";
        button.style.cursor = "pointer";
      }
    });

    closeBtn.addEventListener("click", closeDialog);

    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) {
        closeDialog();
      }
    });

    formElement.addEventListener("submit", (e) => {
      e.preventDefault();
    });

    buttonContainer.appendChild(cancelBtn);
    buttonContainer.appendChild(createBtn);
    formElement.appendChild(buttonContainer);

    headerDiv.appendChild(title);
    headerDiv.appendChild(closeBtn);

    dialogContent.appendChild(headerDiv);
    dialogContent.appendChild(formElement);

    dialog.appendChild(dialogContent);

    document.body.appendChild(dialog);
    document.addEventListener("keydown", handleKeydown);

    console.log("[ProfileManager] Dialog appended to body");
    console.log("[ProfileManager] createBtn element:", createBtn);
    console.log(
      "[ProfileManager] createBtn onclick:",
      (createBtn as any).onclick,
    );

    if ((window as any).lucide && (window as any).lucide.createIcons) {
      (window as any).lucide.createIcons();
    }

    setTimeout(() => {
      dialog.style.opacity = "1";
      dialogContent.style.transform = "scale(1)";
      input.focus();
      console.log(
        "[ProfileManager] Dialog fully visible, button should be clickable",
      );
    }, 10);
      createIcons({ icons: { UserPlus, Settings, Download, Save, ArrowRight, Trash2, Users, AlertCircle, Info, Upload, Trash, X } });
  }

  async createProfileWithPresetData(profileName: string): Promise<void> {
    const existingProfiles = await this.profiles.listProfiles();
    const isFirstProfile = existingProfiles.length === 0;

    if (isFirstProfile) {
      await this.profiles.createProfileWithCurrentData(profileName);
    } else {
      const currentProfile = this.profiles.getCurrentProfile();

      if (currentProfile) {
        await this.flushPendingChanges();
        await this.profiles.saveProfile(currentProfile);
        await this.profiles.flushStorageOperations();
      } else if (existingProfiles.length === 1) {
        await this.flushPendingChanges();
        await this.profiles.saveProfile(existingProfiles[0]);
        await this.profiles.flushStorageOperations();
      }

      await this.profiles.createProfile(profileName);
      await this.profiles.switchProfile(profileName, true);
    }
      createIcons({ icons: { UserPlus, Settings, Download, Save, ArrowRight, Trash2, Users, AlertCircle, Info, Upload, Trash, X } });
  }

  async exportCurrentProfile(): Promise<void> {
    try {
      await this.profiles.downloadExport();
      this.logger.createLog("Exported current profile");
    } catch (error) {
      console.error("Failed to export profile:", error);
      this.modalUtilities.showAlert(
        `Failed to export profile: ${error}`,
        "error",
      );
    }
  }

  async saveCurrentProfile(): Promise<void> {
    const currentProfile = this.profiles.getCurrentProfile();
    if (!currentProfile) {
      this.modalUtilities.showAlert("No active profile to save", "warning");
      return;
    }

    try {
      await this.flushPendingChanges();
      await this.profiles.saveProfile(currentProfile);
      await this.profiles.flushStorageOperations();

      this.logger.createLog(`Saved profile: ${currentProfile}`);
      this.modalUtilities.showAlert("Profile saved successfully!", "success");
    } catch (error) {
      console.error("Failed to save profile:", error);
      this.modalUtilities.showAlert(
        `Failed to save profile: ${error}`,
        "error",
      );
    }
  }

  private async flushPendingChanges(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 150));
    await new Promise((resolve) =>
      requestAnimationFrame(() => resolve(undefined)),
    );
  }

  async switchToProfile(profileId: string): Promise<void> {
    try {
      const currentProfile = this.profiles.getCurrentProfile();
      console.log(
        "[ProfileManager] Switching from profile:",
        currentProfile,
        "to:",
        profileId,
      );

      if (currentProfile) {
        console.log(
          "[ProfileManager] Saving current profile data before switch...",
        );
        await this.flushPendingChanges();
        console.log("[ProfileManager] Flushed pending changes");

        await this.profiles.saveProfile(currentProfile);
        console.log("[ProfileManager] Saved profile data for:", currentProfile);

        this.profiles.emergencySaveProfile(currentProfile);
        console.log("[ProfileManager] Emergency save completed");

        await this.profiles.flushStorageOperations();
        console.log("[ProfileManager] Flushed storage operations");
      }

      console.log("[ProfileManager] Switching to profile:", profileId);
      await this.profiles.setActive(profileId);
      console.log("[ProfileManager] Profile switch completed");

      this.logger.createLog(`Switched to profile: ${profileId}`);

      this.nightmarePlugins.sidemenu.closeMenu();
      this.modalUtilities.showAlert(
        `Switched to profile: ${profileId}`,
        "success",
      );

      // v3: no forced reload. The active-reload listener in src/index.ts
      // re-resolves storage roots, re-registers proxy transports, re-applies
      // themes, and re-activates the per-profile extension host. Proxied
      // iframes reload through the Scramjet controller.
      try {
        for (const tab of (window as any).tabs?.tabs ?? []) {
          try { (window as any).tabs?.reloadTab?.(tab.id); } catch { /* per-tab */ }
        }
      } catch { /* tabs API not ready */ }
    } catch (error) {
      console.error("Failed to switch profile:", error);
      this.modalUtilities.showAlert(
        `Failed to switch profile: ${error}`,
        "error",
      );
    }
  }

  async exportProfile(profileId: string): Promise<void> {
    const currentProfile = this.profiles.getCurrentProfile();
    try {
      if (currentProfile && currentProfile !== profileId) {
        await this.flushPendingChanges();
        try {
          await this.profiles.saveProfile(currentProfile);
          this.profiles.emergencySaveProfile(currentProfile);
          await this.profiles.flushStorageOperations();
        } catch (saveError) {
          console.error(
            "Failed to save current profile before export:",
            saveError,
          );
          this.modalUtilities.showAlert(
            `Failed to save current profile: ${saveError}`,
            "error",
          );
          throw saveError;
        }
        await this.profiles.switchProfile(profileId);
      }

      await this.profiles.downloadExport(`${profileId}-export.json`);

      this.logger.createLog(`Exported profile: ${profileId}`);
    } catch (error) {
      console.error("Failed to export profile:", error);
      this.modalUtilities.showAlert(
        `Failed to export profile: ${error}`,
        "error",
      );
    } finally {
      if (currentProfile && currentProfile !== profileId) {
        try {
          await this.profiles.switchProfile(currentProfile);
        } catch (restoreError) {
          console.error("Failed to restore original profile:", restoreError);
          this.modalUtilities.showAlert(
            `Failed to restore original profile: ${restoreError}`,
            "error",
          );
        }
      }
    }
  }

  async deleteProfile(profileId: string): Promise<void> {
    const confirmed = await this.modalUtilities.showConfirm(
      `Are you sure you want to delete the profile "${profileId}"? This action cannot be undone.`,
      "Delete Profile",
    );
    if (confirmed) {
      try {
        await this.profiles.destroy(profileId);
        this.logger.createLog(`Deleted profile: ${profileId}`);
      } catch (error) {
        console.error("Failed to delete profile:", error);
        this.modalUtilities.showAlert(
          `Failed to delete profile: ${error}`,
          "error",
        );
      }
    }
  }

  async importProfile(): Promise<void> {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".json";
    fileInput.style.display = "none";

    fileInput.onchange = async (event: Event) => {
      const target = event.target as HTMLInputElement;
      const file = target.files?.[0];

      if (file) {
        try {
          const text = await file.text();
          let profileData;
          try {
            profileData = JSON.parse(text);
          } catch {
            this.modalUtilities.showAlert("Invalid JSON file", "error");
            return;
          }

          if (!profileData || typeof profileData !== "object") {
            this.modalUtilities.showAlert("Invalid profile format", "error");
            return;
          }

          const profileName = await this.modalUtilities.showPrompt(
            "Enter a name for the imported profile:",
            profileData.profileId || "Imported Profile",
            "Import Profile",
          );
          if (!profileName || !profileName.trim()) {
            return;
          }

          await this.profiles.createProfile(profileName.trim());

          await this.profiles.switchProfile(profileName.trim());

          if (profileData.cookies) {
            await this.profiles.setCookies(profileData.cookies);
          }
          if (profileData.localStorage) {
            await this.profiles.setLocalStorage(profileData.localStorage);
          }
          if (profileData.indexedDB && profileData.indexedDB.length > 0) {
            await this.profiles.setIDBData(profileData.indexedDB);
          }

          await this.profiles.saveProfile(profileName.trim());

          this.logger.createLog(`Imported profile: ${profileName}`);
          this.modalUtilities
            .showAlert("Profile imported successfully!", "success")
            .then(() => {
              window.location.reload();
            });
        } catch (error) {
          console.error("Failed to import profile:", error);
          this.modalUtilities.showAlert(
            `Failed to import profile: ${error}`,
            "error",
          );
        }
      }

      document.body.removeChild(fileInput);
    };

    document.body.appendChild(fileInput);
    fileInput.click();
  }

  async clearCurrentProfileData(): Promise<void> {
    const confirmed = await this.modalUtilities.showConfirm(
      "Are you sure you want to clear all current browsing data? This will clear cookies, localStorage, and IndexedDB data.",
      "Clear Data",
    );
    if (confirmed) {
      try {
        await this.profiles.clearCurrentProfileData();
        this.logger.createLog("Cleared current profile data");
        this.modalUtilities
          .showAlert("Browsing data cleared successfully!", "success")
          .then(() => {
            window.location.reload();
          });
      } catch (error) {
        console.error("Failed to clear profile data:", error);
        this.modalUtilities.showAlert(
          `Failed to clear profile data: ${error}`,
          "error",
        );
      }
    }
  }

  async inspectCurrentData(): Promise<any> {
    try {
      const currentData = await this.profiles.getCurrentBrowserState();
      const cookies = currentData.cookies;
      const localStorage = currentData.localStorage;
      const idb = currentData.indexedDB;

      console.log("=== CURRENT BROWSER DATA INSPECTION ===");
      console.log("Cookies:", Object.keys(cookies).length, "entries");
      console.log("LocalStorage:", Object.keys(localStorage).length, "entries");
      console.log("IndexedDB:", idb.length, "databases");
      console.log("Cookie keys:", Object.keys(cookies));
      console.log("LocalStorage keys:", Object.keys(localStorage));
      console.log(
        "IndexedDB databases:",
        idb.map((db) => db.name),
      );

      if (localStorage.testProfileData) {
        console.log(
          "✅ Found test profile data:",
          localStorage.testProfileData,
        );
      }
      if (cookies.testProfileCookie) {
        console.log("✅ Found test profile cookie:", cookies.testProfileCookie);
      }

      return { cookies, localStorage, idb };
    } catch (error) {
      console.error("Failed to inspect current data:", error);
    }
  }

  async inspectProfileData(profileId: string): Promise<any> {
    try {
      const profileData = await this.profiles.getProfileData(profileId);
      if (!profileData) {
        console.log(`❌ Profile "${profileId}" not found`);
        return;
      }

      console.log(`=== PROFILE "${profileId}" DATA INSPECTION ===`);
      console.log(
        "Cookies:",
        Object.keys(profileData.cookies).length,
        "entries",
      );
      console.log(
        "LocalStorage:",
        Object.keys(profileData.localStorage).length,
        "entries",
      );
      console.log("IndexedDB:", profileData.indexedDB.length, "databases");
      console.log("Cookie keys:", Object.keys(profileData.cookies));
      console.log("LocalStorage keys:", Object.keys(profileData.localStorage));
      console.log(
        "IndexedDB databases:",
        profileData.indexedDB.map((db) => db.name),
      );

      if (profileData.localStorage.testProfileData) {
        console.log(
          "✅ Found test profile data:",
          profileData.localStorage.testProfileData,
        );
      }
      if (profileData.cookies.testProfileCookie) {
        console.log(
          "✅ Found test profile cookie:",
          profileData.cookies.testProfileCookie,
        );
      }

      return profileData;
    } catch (error) {
      console.error(`Failed to inspect profile "${profileId}":`, error);
    }
  }

  async createTestData(): Promise<void> {
    try {
      localStorage.setItem(
        "testProfileData",
        `Test data created at ${new Date().toISOString()}`,
      );
      localStorage.setItem(
        "profileTestKey",
        "This should be saved with the profile",
      );

      document.cookie = `testProfileCookie=TestValue_${Date.now()}; path=/`;

      console.log("✅ Test data created:");
      console.log("- localStorage: testProfileData, profileTestKey");
      console.log("- Cookie: testProfileCookie");

      this.modalUtilities.showAlert(
        "Test data created! Check console for details.",
        "success",
      );
    } catch (error) {
      console.error("Failed to create test data:", error);
      this.modalUtilities.showAlert(
        `Failed to create test data: ${error}`,
        "error",
      );
    }
  }
}
