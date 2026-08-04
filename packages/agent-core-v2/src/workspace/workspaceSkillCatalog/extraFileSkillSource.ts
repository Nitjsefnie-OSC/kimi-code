/**
 * `workspaceSkillCatalog` domain — extra `ISkillSource` producer.
 *
 * Discovers user-configured extra skill directories (`extraSkillDirs`) through
 * `ISkillDiscovery`, contributing them at priority 10 (above plugin / builtin,
 * below user / workspace). Relative paths resolve against the workspace root;
 * `~` and `~/...` resolve against the bootstrap home dir. Re-fires
 * `onDidChange` when the `extraSkillDirs` config section changes so the
 * catalog re-scans THIS source only. Bound at Workspace scope so every
 * session of the handler shares one scan.
 */

import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import { Disposable } from '#/_base/di/lifecycle';
import { Emitter, type Event } from '#/_base/event';
import { LifecycleScope, ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { IBootstrapService } from '#/app/bootstrap/bootstrap';
import { IConfigService } from '#/app/config/config';
import {
  EXTRA_SKILL_DIRS_SECTION,
  type ExtraSkillDirsConfig,
} from '#/app/skillCatalog/configSection';
import { configuredRoots } from '#/app/skillCatalog/skillRoots';
import { ISkillDiscovery } from '#/app/skillCatalog/skillDiscovery';
import {
  SKILL_SOURCE_PRIORITY,
  type ISkillSource,
  type SkillContribution,
} from '#/app/skillCatalog/skillSource';
import { IWorkspaceContext } from '#/workspace/workspaceContext/workspaceContext';

export interface IExtraFileSkillSource extends ISkillSource {
  readonly _serviceBrand: undefined;
}

export const IExtraFileSkillSource: ServiceIdentifier<IExtraFileSkillSource> =
  createDecorator<IExtraFileSkillSource>('extraFileSkillSource');

export class ExtraFileSkillSource extends Disposable implements IExtraFileSkillSource {
  declare readonly _serviceBrand: undefined;

  readonly id = 'extra';
  readonly priority = SKILL_SOURCE_PRIORITY.extra;
  private readonly onDidChangeEmitter = this._register(new Emitter<void>());
  readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

  constructor(
    @ISkillDiscovery private readonly discovery: ISkillDiscovery,
    @IConfigService private readonly config: IConfigService,
    @IWorkspaceContext private readonly workspace: IWorkspaceContext,
    @IBootstrapService private readonly bootstrap: IBootstrapService,
  ) {
    super();
    this._register(
      this.config.onDidSectionChange((event) => {
        if (event.domain === EXTRA_SKILL_DIRS_SECTION) this.onDidChangeEmitter.fire();
      }),
    );
  }

  async load(): Promise<SkillContribution> {
    await this.config.ready;
    const raw = this.config.get<ExtraSkillDirsConfig>(EXTRA_SKILL_DIRS_SECTION);
    const extraSkillDirs = raw ?? [];
    // See DEBUG_SKILL_ROOTS in skillCatalog/skillRoots.ts. Traced here too
    // because "configured but not loaded" and "never configured" look
    // identical downstream: `?? []` erases the difference silently.
    if (process.env['DEBUG_SKILL_ROOTS']) {
      process.stderr.write(
        `[skill-roots] extraFileSkillSource.load section=${EXTRA_SKILL_DIRS_SECTION} `
        + `present=${raw !== undefined} value=${JSON.stringify(extraSkillDirs)} `
        + `cwd=${this.workspace.cwd} osHomeDir=${this.bootstrap.osHomeDir}\n`,
      );
    }
    const contribution = await this.discovery.discover(
      await configuredRoots(extraSkillDirs, this.workspace.cwd, this.bootstrap.osHomeDir, 'extra'),
    );
    if (process.env['DEBUG_SKILL_ROOTS']) {
      process.stderr.write(
        `[skill-roots] extraFileSkillSource.discovered n=${contribution.skills?.length ?? 0}\n`,
      );
    }
    return contribution;
  }
}

registerScopedService(
  LifecycleScope.Workspace,
  IExtraFileSkillSource,
  ExtraFileSkillSource,
  ScopeActivation.OnScopeCreated,
  'workspaceSkillCatalog',
);
