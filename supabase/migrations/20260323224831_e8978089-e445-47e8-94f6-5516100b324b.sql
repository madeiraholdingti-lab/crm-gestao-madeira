
-- Deletar mensagens da tabela 'mensagens' vinculadas à instância testenov
DELETE FROM mensagens
WHERE conversa_id IN (
  SELECT id FROM conversas
  WHERE instancia_id = '5454fe27-0d5c-4fef-a8d8-b1a87ed7fb05'
     OR current_instance_id = '5454fe27-0d5c-4fef-a8d8-b1a87ed7fb05'
     OR orig_instance_id = '5454fe27-0d5c-4fef-a8d8-b1a87ed7fb05'
);

-- Deletar mensagens da tabela 'messages' vinculadas à instância testenov
DELETE FROM messages
WHERE instancia_whatsapp_id = '5454fe27-0d5c-4fef-a8d8-b1a87ed7fb05';
