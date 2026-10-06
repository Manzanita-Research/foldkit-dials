import { Array } from 'effect'
import type * as Command from 'foldkit/command'
import * as Update from 'foldkit/update'

/** Adds a Command to an update result, keeping its Model, its Commands, and
 *  its OutMessage. */
export const withCommand = <Model, Message, OutMessage>(
  result: Update.ReturnWithOutMessage<Model, Message, OutMessage>,
  command: Command.Command<Message>,
): Update.ReturnWithOutMessage<Model, Message, OutMessage> =>
  Update.withOutMessage(
    {
      model: result.model,
      commands: Array.append(result.commands ?? [], command),
    },
    result.outMessage,
  )
