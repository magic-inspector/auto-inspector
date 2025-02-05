import { TaskManagerService } from "@/core/services/task-manager-service";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import {
  ManagerAgentPrompt,
  ManagerAgentHumanPrompt,
} from "./manager-agent.prompt";
import { DomService } from "@/infra/services/dom-service";
import {
  DEFAULT_AGENT_MAX_ACTIONS_PER_TASK,
  DEFAULT_AGENT_MAX_RETRIES,
} from "./manager-agent.config";
import { ManagerAgentAction, ManagerResponse } from "./manager-agent.types";
import { Reporter } from "@/core/interfaces/reporter.interface";
import { Browser, Coordinates } from "@/core/interfaces/browser.interface";
import { EvaluationAgent } from "../evaluation-agent/evaluation-agent";
import { Task } from "@/core/entities/task";
import { LLM } from "@/core/interfaces/llm.interface";

export type ManagerAgentConfig = {
  maxActionsPerTask?: number;
  maxRetries?: number;

  taskManager: TaskManagerService;
  domService: DomService;
  browserService: Browser;
  llmService: LLM;
  evaluator: EvaluationAgent;
  reporter: Reporter;
};

export class ManagerAgent {
  private isSuccess: boolean = false;
  private isFailure: boolean = false;
  private reason: string = "";
  private retries: number = 0;

  private readonly maxActionsPerTask: number;
  private readonly maxRetries: number;

  private readonly taskManager: TaskManagerService;
  private readonly domService: DomService;
  private readonly browserService: Browser;
  private readonly llmService: LLM;
  private readonly reporter: Reporter;
  private readonly evaluator: EvaluationAgent;

  constructor(config: ManagerAgentConfig) {
    this.taskManager = config.taskManager;
    this.domService = config.domService;
    this.browserService = config.browserService;
    this.llmService = config.llmService;
    this.reporter = config.reporter;
    this.evaluator = config.evaluator;

    this.maxActionsPerTask =
      config.maxActionsPerTask ?? DEFAULT_AGENT_MAX_ACTIONS_PER_TASK;
    this.maxRetries = config.maxRetries ?? DEFAULT_AGENT_MAX_RETRIES;
  }

  private onSuccess(reason: string) {
    this.reporter.success(`Manager agent completed successfully: ${reason}`);
    this.isSuccess = true;
    this.reason = reason;
  }

  private onFailure(reason: string) {
    this.reporter.error(`Manager agent failed: ${reason}`);
    this.isFailure = true;
    this.reason = reason;
  }

  private async info(message: string) {
    this.reporter.info(message);
  }

  private async reportAction(action: ManagerAgentAction) {
    this.info(`[Performing action...]: ${JSON.stringify(action.name)}`);
  }

  private async reportActionDone(action: ManagerAgentAction) {
    this.info(`[Action done...]: ${JSON.stringify(action.name)}`);
  }

  private async beforeAction(action: ManagerAgentAction) {
    await this.reportAction(action);
  }

  private async afterAction(action: ManagerAgentAction) {
    await this.reportActionDone(action);
  }

  private async incrementRetries() {
    this.retries += 1;
  }

  private async resetRetries() {
    this.retries = 0;
  }

  get isCompleted() {
    return this.isSuccess || this.isFailure;
  }

  async launch(startUrl: string, initialPrompt: string) {
    await this.browserService.launch(startUrl);

    this.taskManager.setEndGoal(initialPrompt);

    return this.run();
  }

  async run(): Promise<{
    status: "success" | "failure";
    reason: string;
  }> {
    return new Promise(async (resolve) => {
      this.reporter?.info("Starting manager agent");

      while (!this.isCompleted) {
        if (this.retries >= this.maxRetries) {
          this.onFailure("Max retries reached");

          return resolve({
            status: "failure",
            reason: "Max retries reached",
          });
        }

        await this.reporter.reportProgress(true);

        const task = await this.defineNextTask();

        await this.reporter.reportProgress(false, task);

        await this.executeTask(task);
      }

      return resolve({
        status: this.isSuccess ? "success" : "failure",
        reason: this.reason,
      });
    });
  }

  async defineNextTask(): Promise<Task> {
    const parser = new JsonOutputParser<ManagerResponse>();

    const systemMessage = new ManagerAgentPrompt(
      this.maxActionsPerTask,
    ).getSystemMessage();

    const { screenshot, stringifiedDomState } =
      await this.domService.getInteractiveElements();

    const humanMessage = new ManagerAgentHumanPrompt().getHumanMessage({
      serializedTasks: this.taskManager.getSerializedTasks(),
      screenshotUrl: screenshot,
      stringifiedDomState,
      pageUrl: this.browserService.getPageUrl(),
    });

    const messages = [systemMessage, humanMessage];

    try {
      const parsedResponse = await this.llmService.invokeAndParse(
        messages,
        parser,
      );

      return Task.InitPending(
        parsedResponse.currentState.nextGoal,
        parsedResponse.actions,
      );
    } catch (error) {
      console.error("Error parsing agent response:", error);
      return Task.InitPending("Keep trying", []);
    }
  }

  async executeTask(task: Task) {
    for (const action of task.actions) {
      try {
        await this.executeAction(action);
      } catch (error) {
        console.log("Error executing action", error);
      }
    }

    const { isCompleted, reason } =
      await this.evaluator.evaluateTaskCompletion(task);

    if (isCompleted) {
      task.complete(reason);
      this.resetRetries();
    } else {
      task.fail(reason);
      this.incrementRetries();
    }

    this.taskManager.add(task);

    this.reporter.reportProgress(false, task);
  }

  private async executeAction(action: ManagerAgentAction) {
    let coordinates: Coordinates | null = null;

    await this.beforeAction(action);

    switch (action.name) {
      case "clickElement":
        coordinates = this.domService.getIndexSelector(action.params.index);

        if (!coordinates) {
          throw new Error("Index or coordinates not found");
        }

        await this.domService.resetHighlightElements();

        await this.domService.highlightElementPointer(coordinates);

        await this.browserService.mouseClick(coordinates.x, coordinates.y);

        await this.domService.resetHighlightElements();

        break;

      case "fillInput":
        coordinates = this.domService.getIndexSelector(action.params.index);

        if (!coordinates) {
          throw new Error("Index or coordinates not found");
        }

        await this.domService.highlightElementPointer(coordinates);
        await this.browserService.fillInput(action.params.text, coordinates);
        await this.domService.resetHighlightElements();

        break;

      case "scrollDown":
        await this.browserService.scrollDown();
        await this.domService.resetHighlightElements();
        await this.domService.highlightElementWheel("down");

        break;

      case "scrollUp":
        await this.browserService.scrollUp();

        await this.domService.resetHighlightElements();
        await this.domService.highlightElementWheel("up");

        break;

      case "takeScreenshot":
        await this.domService.resetHighlightElements();
        await this.domService.highlightForSoM();
        break;

      case "goToUrl":
        await this.browserService.goToUrl(action.params.url);
        break;

      case "triggerSuccess":
        this.onSuccess(action.params.reason);
        break;

      case "triggerFailure":
        this.onFailure(action.params.reason);
        break;
    }

    await this.afterAction(action);
  }
}
